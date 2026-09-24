import { parseKeyTimeline, parseWorldFile, TimelineError, type KeyPress, type WorldFile } from '@robots/sim-core';
import { DEFAULT_WORLD, readBlueprint, readJson, resolveBlueprint, resolveReplay, resolveUserPath } from './blueprintFiles';
import { formatReport, InvalidBlueprint, runSim, type Drop } from './commands/run';
import { checkDeterminism } from './commands/determinism';
import { validateCommand } from './commands/validate';
import { showBlueprint } from './commands/show';
import { tune } from './commands/tune';
import { formatReplay, replayCommand } from './commands/replay';

const USAGE = `robots sim <command> <blueprint> [flags]

<blueprint> is a name in blueprints/ (car) or a path to a .json file.

commands
  run <bp>           spawn the blueprint, simulate, print the robot once per second
  show <bp>          print the grid, legend, mass, center of mass, and body structure
  validate <bp>      print validator issues; exit 1 on errors
  determinism <bp>   run twice and compare final hashes (exit 1 on mismatch)
  replay <file>      rerun a replay saved from the app (a path, or a name in replays/) and check it
                     ends in the same state (exit 1 on mismatch)
  tune               measure the driving targets (docs/plans/M3-control.md) on test robots

flags
  --world <path>     world json (default: worlds/flat.json)
  --seconds <n>      simulated seconds (default: 5)
  --seed <n>         world seed (default: 1)
  --x <n> --y <n>    where the core lands (default: the world spawn point)
  --keys <timeline>  keys to press, in seconds from the start: "d:0-3, a:3.5-4, w:5" (w:5 is a tap),
                     or a .json file like [{ "key": "d", "down": 0, "up": 3 }]
  --unlimited        unlimited energy from the start
  --drop <bp>@<t>:<x>,<y>
                     also spawn blueprint <bp> at t seconds with its root at (x, y), e.g. a bomb on the robot:
                     --drop bomb@2:3,6 (repeat for more)
  --json             print the run report as json`;

/** Flags that never take a value, so `--json run` does not swallow the command. */
const BOOLEAN_FLAGS = new Set(['json', 'unlimited']);

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

/** `bomb@2:3,6`: blueprint bomb at 2 s, root at (3, 6). */
function parseDrop(raw: string): Drop {
  const num = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const m = new RegExp(`^([^@]+)@(${num}):(${num}),(${num})$`).exec(raw.trim());
  if (!m) throw new Error(`--drop must look like bomb@2:3,6 (blueprint@seconds:x,y), got ${raw}`);
  const [, name = '', t = '0', x = '0', y = '0'] = m;
  const loaded = readBlueprint(resolveBlueprint(name));
  for (const f of loaded.missing) console.error(`warning: script file ${f} not found next to ${name}`);
  return { name, blueprint: loaded.raw, t: Number(t), at: { x: Number(x), y: Number(y) } };
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
  if (command === '' || command === 'help') {
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
  const blueprint = loaded.raw;

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
  const opts = { seconds, seed, ...(at ? { at } : {}), ...(keys ? { keys } : {}), ...(flags.has('unlimited') ? { unlimited: true } : {}), ...(drops.length > 0 ? { drops } : {}) };

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

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
