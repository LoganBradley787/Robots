import { parseWorldFile, type WorldFile } from '@robots/sim-core';
import { DEFAULT_WORLD, readJson, resolveBlueprint, resolveUserPath } from './blueprintFiles';
import { formatReport, InvalidBlueprint, runSim } from './commands/run';
import { checkDeterminism } from './commands/determinism';
import { validateCommand } from './commands/validate';
import { showBlueprint } from './commands/show';

const USAGE = `robots sim <command> <blueprint> [flags]

<blueprint> is a name in blueprints/ (car) or a path to a .json file.

commands
  run <bp>           spawn the blueprint, simulate, print the robot once per second
  show <bp>          print the grid, legend, mass, center of mass, and body structure
  validate <bp>      print validator issues; exit 1 on errors
  determinism <bp>   run twice and compare final hashes (exit 1 on mismatch)

flags
  --world <path>     world json (default: worlds/flat.json)
  --seconds <n>      simulated seconds (default: 5)
  --seed <n>         world seed (default: 1)
  --x <n> --y <n>    where the core lands (default: the world spawn point)
  --json             print the run report as json`;

/** Flags that never take a value, so `--json run` does not swallow the command. */
const BOOLEAN_FLAGS = new Set(['json']);

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(a.slice(2)) && next !== undefined && !next.startsWith('--')) {
        flags.set(a.slice(2), next);
        i++;
      } else {
        flags.set(a.slice(2), 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
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

function loadWorld(flags: Map<string, string>): WorldFile {
  const p = flags.get('world');
  return parseWorldFile(readJson(p === undefined ? DEFAULT_WORLD : resolveUserPath(p)));
}

async function main(): Promise<number> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command = '', bpArg] = positional;
  if (command === '' || command === 'help') {
    console.log(USAGE);
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
  const blueprint = readJson(resolveBlueprint(bpArg));

  if (command === 'show') {
    console.log(showBlueprint(blueprint));
    return 0;
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
  const opts = at ? { seconds, seed, at } : { seconds, seed };

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
