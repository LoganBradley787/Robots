import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorldFile, type WorldFile } from '@robots/sim-core';
import { runSim } from './commands/run';
import { checkDeterminism } from './commands/determinism';

const DEFAULT_WORLD = fileURLToPath(new URL('../../../worlds/flat.json', import.meta.url));

const USAGE = `robots sim <command> [flags]

commands
  run            simulate the world with a test box, print samples once per second
  determinism    run twice and compare final hashes (exit 1 on mismatch)

flags
  --world <path>     world json (default: worlds/flat.json)
  --seconds <n>      simulated seconds (default: 5)
  --seed <n>         world seed (default: 1)
  --json             print the run report as json`;

/** Flags that never take a value, so `--json run` does not swallow the command. */
const BOOLEAN_FLAGS = new Set(['json']);

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  let command = '';
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
    } else if (command === '') {
      command = a;
    }
  }
  return { command, flags };
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

function loadWorld(path: string): WorldFile {
  return parseWorldFile(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const worldPath = flags.get('world') ?? DEFAULT_WORLD;
  const seconds = numberFlag(flags, 'seconds', 5);
  const seed = seedFlag(flags);

  if (command === 'run') {
    const report = await runSim(loadWorld(worldPath), { seconds, seed });
    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const s of report.samples) {
        console.log(
          `t=${s.time.toFixed(2).padStart(6)}  box x=${s.box.x.toFixed(3)} y=${s.box.y.toFixed(3)} angle=${s.box.angle.toFixed(3)}  hash=${s.hash}`,
        );
      }
      console.log(`final: ticks=${report.ticks} hash=${report.finalHash}`);
    }
    return 0;
  }

  if (command === 'determinism') {
    const d = await checkDeterminism(loadWorld(worldPath), { seconds, seed });
    console.log(`run A: ${d.hashA}`);
    console.log(`run B: ${d.hashB}`);
    console.log(d.equal ? `DETERMINISTIC over ${d.ticks} ticks` : 'MISMATCH: the simulation is not deterministic');
    return d.equal ? 0 : 1;
  }

  console.log(USAGE);
  return command === '' || command === 'help' ? 0 : 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
