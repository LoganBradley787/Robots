import { parseKeyTimeline, parseWorldFile, TimelineError, type KeyPress, type WorldFile } from '@robots/sim-core';
import { BLUEPRINT_DIR, DEFAULT_WORLD, readBlueprint, readJson, resolveBlueprint, resolveReplay, resolveUserPath } from './blueprintFiles';
import { formatReport, InvalidBlueprint, runSim, type Drop } from './commands/run';
import { checkDeterminism } from './commands/determinism';
import { validateCommand } from './commands/validate';
import { showBlueprint } from './commands/show';
import { tune } from './commands/tune';
import { formatReplay, replayCommand } from './commands/replay';
import { placeCommand } from './commands/place';
import { mirrorCommand } from './commands/mirror';
import { formatParts, partRows } from './commands/parts';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { defaultRegistry, isRotation, orientRaw, type Rotation } from '@robots/sim-core';
import { parseSpawnSuffixes, parseTeam } from './spawnSpec';

const USAGE = `robots sim <command> <blueprint> [flags]

<blueprint> is a name in blueprints/ (car) or a path to a .json file.

commands
  run <bp>           spawn the blueprint and simulate. Prints robot A (the blueprint) once per second, then
                     what happened in order (keys, decouplers, pieces breaking off and waking, parts lost,
                     explosions, script log() lines and crashes), every piece's final state by letter, and a
                     side view of every piece's path over the ground and boxes
  show <bp>          print the grid, legend, mass, center of mass, body structure, and every core's controls
  parts              print every part: builder key, legend tokens, mass, health, faces, power, what it does
  validate <bp>      print validator issues; exit 1 on errors
  determinism <bp>   run twice and compare final hashes (exit 1 on mismatch)
  replay <file>      rerun a replay saved from the app (a path, or a name in replays/) and check it
                     ends in the same state (exit 1 on mismatch)
  tune               measure the driving targets (docs/plans/M3-control.md) on test robots
  place <target> <source> --at x,y [--rot 90] [--mirror] [--save <name>] [--force]
                     place a copy of <source> on <target> with its root part at cell (x, y) of <target>'s
                     grid (x right, y up, the bottom row is y 0), as the builder's Blueprints palette does.
                     Prints the result's json (notes go to stderr, so > file.json is clean). --save <name>
                     writes blueprints/<name>.json and its scripts as files; --save <path>.json writes them
                     there instead (a drafts folder). --force replaces an existing file
  mirror <bp> [--axis <half cells>] [--save <name>] [--force]
                     print the blueprint flipped left to right (x becomes axis - x; the default axis keeps it
                     in place). --save works as for place

flags
  --world <path>     world json (default: worlds/flat.json)
  --seconds <n>      simulated seconds (default: 5)
  --seed <n>         world seed (default: 1)
  --x <n> --y <n>    where the core lands (default: the world spawn point)
  --keys <timeline>  keys to press, in seconds from the start: "d:0-3, a:3.5-4, w:5" (w:5 is a tap),
                     or a .json file like [{ "key": "d", "down": 0, "up": 3 }]
  --unlimited        unlimited energy from the start
  --team <team>      the robot's team: yours (0, the default), enemy (1), or a number
  --flip             deploy the robot flipped left to right (around its core)
  --rot <deg>        deploy it turned 90, 180, or 270 degrees counterclockwise (after --flip)
  --drop <bp>@<t>:<x>,<y>[:enemy][:flip][:rot90]
                     also spawn blueprint <bp> at t seconds with its root at (x, y), e.g. a bomb on the robot:
                     --drop bomb@2:3,6 (repeat for more). Suffixes set its team (enemy, yours, team2) and
                     facing: --drop enemy-drone@0:80,20:enemy:flip
  --json             print the run report as json`;

/** Flags that never take a value, so `--json run` does not swallow the command. */
const BOOLEAN_FLAGS = new Set(['json', 'unlimited', 'mirror', 'force', 'help', 'flip']);

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string>; drops: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const drops: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(a.slice(2)) && next !== undefined && !next.startsWith('--')) {
        if (a === '--drop') drops.push(next);
        else flags.set(a.slice(2), next);
        i++;
      } else if (a === '--drop') {
        throw new Error('--drop needs a value like bomb@2:3,6 (blueprint@seconds:x,y)');
      } else {
        flags.set(a.slice(2), 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, drops };
}

/** `bomb@2:3,6`: blueprint bomb at 2 s, root at (3, 6); `enemy-drone@0:80,20:enemy:flip` also sets its team and facing (M8). */
function parseDrop(raw: string): Drop {
  const num = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const m = new RegExp(`^([^@]+)@(${num}):(${num}),(${num})((?::[A-Za-z0-9]+)*)$`).exec(raw.trim());
  if (!m) throw new Error(`--drop must look like bomb@2:3,6 (blueprint@seconds:x,y), with optional :enemy, :flip, :rot90 after it; got ${raw}`);
  const [, name = '', t = '0', x = '0', y = '0', rest = ''] = m;
  const spec = parseSpawnSuffixes(rest.split(':').filter((s) => s !== ''), `--drop ${name}`);
  const loaded = readBlueprint(resolveBlueprint(name));
  for (const f of loaded.missing) console.error(`warning: script file ${f} not found next to ${name}`);
  return { name, blueprint: orientRaw(loaded.raw, spec, defaultRegistry()), t: Number(t), at: { x: Number(x), y: Number(y) }, ...(spec.team !== 0 ? { team: spec.team } : {}) };
}

function numberFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (raw === undefined) return fallback;
  const v = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(v)) throw new Error(`--${key} must be a number, got ${raw}`);
  return v;
}

function seedFlag(flags: Map<string, string>): number {
  const v = numberFlag(flags, 'seed', 1);
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`--seed must be an integer from 0 to 4294967295, got ${v}`);
  return v;
}

function keysFlag(flags: Map<string, string>): KeyPress[] | undefined {
  const raw = flags.get('keys');
  if (raw === undefined) return undefined;
  return parseKeyTimeline(raw.trim().endsWith('.json') ? readJson(resolveUserPath(raw.trim())) : raw);
}

function loadWorld(flags: Map<string, string>): WorldFile {
  const p = flags.get('world');
  return parseWorldFile(readJson(p === undefined ? DEFAULT_WORLD : resolveUserPath(p)));
}

async function main(): Promise<number> {
  const { positional, flags, drops: dropArgs } = parseArgs(process.argv.slice(2));
  const [command = '', bpArg] = positional;
  if (command === '' || command === 'help' || flags.has('help')) {
    console.log(USAGE);
    return 0;
  }
  if (command === 'replay') {
    if (bpArg === undefined) {
      console.error('replay needs a replay file, like replays/2026-09-23-1512-car.json');
      return 2;
    }
    const r = await replayCommand(readJson(resolveReplay(bpArg)));
    console.log(flags.has('json') ? JSON.stringify(r, null, 2) : formatReplay(r));
    return r.matches ? 0 : 1;
  }
  if (command === 'tune') {
    console.log(await tune());
    return 0;
  }
  if (command === 'place') return place(positional, flags);
  if (command === 'parts') {
    const rows = partRows(defaultRegistry());
    console.log(flags.has('json') ? JSON.stringify(rows, null, 2) : formatParts(rows));
    return 0;
  }
  if (command === 'mirror') return mirror(positional, flags);
  if (!['run', 'show', 'validate', 'determinism'].includes(command)) {
    console.log(USAGE);
    return 2;
  }
  if (bpArg === undefined) {
    console.error(`${command} needs a blueprint name or path\n`);
    console.log(USAGE);
    return 2;
  }
  const loaded = readBlueprint(resolveBlueprint(bpArg));
  for (const f of loaded.missing) console.error(`warning: script file ${f} not found next to the blueprint`);
  const rot = flags.has('rot') ? numberFlag(flags, 'rot', 0) : 0;
  if (!isRotation(rot)) {
    console.error(`--rot must be 0, 90, 180, or 270, got ${rot}`);
    return 2;
  }
  // show and validate read the file as written; run and determinism deploy it flipped or turned (M8).
  const deploy = command === 'run' || command === 'determinism';
  const blueprint = deploy ? orientRaw(loaded.raw, { flip: flags.has('flip'), rot }, defaultRegistry()) : loaded.raw;
  const team = flags.has('team') ? parseTeam(flags.get('team') ?? '') : 0;

  if (command === 'show') {
    const s = showBlueprint(blueprint);
    console.log(s.text);
    return s.ok ? 0 : 1;
  }
  if (command === 'validate') {
    const v = validateCommand(blueprint);
    console.log(v.text);
    return v.ok ? 0 : 1;
  }

  const seconds = numberFlag(flags, 'seconds', 5);
  const seed = seedFlag(flags);
  const file = loadWorld(flags);
  const at = flags.has('x') || flags.has('y') ? { x: numberFlag(flags, 'x', file.spawn.x), y: numberFlag(flags, 'y', file.spawn.y) } : undefined;
  let keys: KeyPress[] | undefined;
  try {
    keys = keysFlag(flags);
  } catch (e) {
    if (e instanceof TimelineError) {
      console.error(`--keys: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const drops = dropArgs.map(parseDrop);
  for (const d of drops) {
    if (d.t < 0) throw new Error(`--drop ${d.name}: the time must not be negative`);
    if (d.t >= seconds) console.error(`warning: --drop ${d.name} at ${d.t} s is after the run ends (${seconds} s), so it never lands`);
  }
  const opts = { seconds, seed, ...(team !== 0 ? { team } : {}), ...(at ? { at } : {}), ...(keys ? { keys } : {}), ...(flags.has('unlimited') ? { unlimited: true } : {}), ...(drops.length > 0 ? { drops } : {}) };

  try {
    if (command === 'run') {
      const report = await runSim(file, blueprint, opts);
      console.log(flags.has('json') ? JSON.stringify(report, null, 2) : formatReport(report));
      return 0;
    }
    const d = await checkDeterminism(file, blueprint, opts);
    console.log(`run A: ${d.hashA}`);
    console.log(`run B: ${d.hashB}`);
    console.log(d.equal ? `DETERMINISTIC over ${d.ticks} ticks` : 'MISMATCH: the simulation is not deterministic');
    return d.equal ? 0 : 1;
  } catch (e) {
    if (e instanceof InvalidBlueprint) {
      console.log(e.message);
      return 1;
    }
    throw e;
  }
}

function place(positional: string[], flags: Map<string, string>): number {
  const [, targetArg, sourceArg] = positional;
  const atRaw = flags.get('at');
  const at = atRaw === undefined ? null : /^(-?\d+),(-?\d+)$/.exec(atRaw.trim());
  if (targetArg === undefined || sourceArg === undefined || !at) {
    console.error('place needs a target, a source, and a cell: pnpm sim place car missile --at 2,3');
    return 2;
  }
  const rot = flags.has('rot') ? numberFlag(flags, 'rot', 0) : undefined;
  if (rot !== undefined && !isRotation(rot)) {
    console.error(`--rot must be 0, 90, 180, or 270, got ${rot}`);
    return 2;
  }
  const save = saveTarget(flags);
  if (save === null) return 2;
  const target = readBlueprint(resolveBlueprint(targetArg));
  const source = readBlueprint(resolveBlueprint(sourceArg));
  for (const f of [...target.missing, ...source.missing]) console.error(`warning: script file ${f} not found`);
  const out = placeCommand(target.raw, source.raw, {
    at: { x: Number(at[1]), y: Number(at[2]) },
    ...(rot !== undefined ? { rot: rot as Rotation } : {}),
    ...(flags.has('mirror') ? { mirror: true } : {}),
    ...(save ? { saveAs: save.name } : {}),
  });
  if (!writeSaved(save, out.files, flags)) return 1;
  return printOutput(out);
}

/** Where `--save` writes: a name in blueprints/ (`missile-car`) or a path to a .json file anywhere (a draft folder). */
interface SaveTarget {
  name: string;
  dir: string;
}

function saveTarget(flags: Map<string, string>): SaveTarget | undefined | null {
  const raw = flags.get('save');
  if (raw === undefined) return undefined;
  if (raw.endsWith('.json') || raw.includes('/')) {
    const path = resolveUserPath(raw.endsWith('.json') ? raw : `${raw}.json`);
    const name = basename(path, '.json');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      console.error(`--save: the file name must be lowercase letters, digits, and dashes, like drafts/missile-car.json; got ${name}.json`);
      return null;
    }
    return { name, dir: dirname(path) };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    console.error(`--save takes a blueprint name of lowercase letters, digits, and dashes (like missile-car) or a path to a .json file; got ${raw}`);
    return null;
  }
  return { name: raw, dir: BLUEPRINT_DIR };
}

/** Writes saved files atomically; refuses to replace an existing <name>.json without --force. */
function writeSaved(target: SaveTarget | undefined, files: readonly { file: string; text: string }[], flags: Map<string, string>): boolean {
  if (target === undefined || files.length === 0) return true;
  const json = resolve(target.dir, `${target.name}.json`);
  if (existsSync(json) && !flags.has('force')) {
    console.error(`${json} exists; add --force to replace it`);
    return false;
  }
  for (const f of files) {
    const p = resolve(target.dir, f.file);
    writeFileSync(`${p}.tmp`, f.text);
    renameSync(`${p}.tmp`, p);
  }
  return true;
}

/** The json (or what was saved) on stdout, notes on stderr, so `> file.json` captures a clean blueprint. */
function printOutput(out: { ok: boolean; text: string; notes: string[] }): number {
  if (out.text !== '') console.log(out.text);
  for (const n of out.notes) console.error(n);
  return out.ok ? 0 : 1;
}

function mirror(positional: string[], flags: Map<string, string>): number {
  const [, bpArg] = positional;
  if (bpArg === undefined) {
    console.error('mirror needs a blueprint: pnpm sim mirror car');
    return 2;
  }
  const axis = flags.has('axis') ? numberFlag(flags, 'axis', 0) : undefined;
  if (axis !== undefined && !Number.isInteger(axis)) {
    console.error(`--axis is in half cells and must be a whole number (4 mirrors across column 2, 5 across the line between columns 2 and 3), got ${axis}`);
    return 2;
  }
  const save = saveTarget(flags);
  if (save === null) return 2;
  const loaded = readBlueprint(resolveBlueprint(bpArg));
  for (const f of loaded.missing) console.error(`warning: script file ${f} not found`);
  const out = mirrorCommand(loaded.raw, { ...(axis !== undefined ? { axis } : {}), ...(save ? { saveAs: save.name } : {}) });
  if (!writeSaved(save, out.files, flags)) return 1;
  return printOutput(out);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
