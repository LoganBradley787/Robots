import { nearestNames } from '@robots/sim-core';

/** What `run` and `determinism` both read: where and how the robot is deployed, and what happens during the run. */
const RUN_FLAGS = ['world', 'seconds', 'seed', 'x', 'y', 'keys', 'unlimited', 'no-smoke-jam', 'team', 'flip', 'rot', 'drop'] as const;

/**
 * Every flag each command reads (review T3). A flag that is not listed for its command is refused, so a misspelled
 * `--secnds 1` cannot quietly run the default. `--help` works everywhere and is not listed. Add a flag here in the
 * same change that makes a command read it.
 */
export const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  run: [...RUN_FLAGS, 'json'],
  determinism: RUN_FLAGS,
  show: [],
  validate: [],
  parts: ['json'],
  replay: ['json'],
  tune: [],
  place: ['at', 'rot', 'mirror', 'save', 'force'],
  mirror: ['axis', 'save', 'force'],
  bench: ['n', 'seconds', 'json'],
  hashes: ['seconds', 'save', 'against'],
  duel: ['ya', 'yb', 'seed', 'seconds', 'world', 'bounds', 'no-smoke-jam', 'json'],
  tournament: ['seeds', 'seconds', 'jobs', 'out', 'only', 'world', 'bounds', 'speed-seconds'],
};

const dashed = (names: readonly string[]): string => (names.length === 0 ? 'no flags' : names.map((n) => `--${n}`).join(', '));

/**
 * Why these flags cannot be given to `command`, or undefined when they all can. For an unknown command only flags no
 * command has are refused: `--jsn run car` reads `run` as the flag's value, and the flag is the mistake to name.
 */
export function flagProblem(command: string, given: readonly string[]): string | undefined {
  const own = COMMAND_FLAGS[command];
  const every = [...new Set(Object.values(COMMAND_FLAGS).flat())];
  for (const flag of given) {
    if (flag === 'help' || own?.includes(flag)) continue;
    const takes = own ? `${command} takes ${dashed(own)}` : undefined;
    if (!every.includes(flag)) {
      // A flag of this command first: `--sed` on `tournament` means --seeds, on `run` --seed.
      const near = nearestNames(flag, own ?? [])[0] ?? nearestNames(flag, every)[0];
      return `unknown flag --${flag}${near !== undefined ? `; did you mean --${near}?` : ''}${takes ? ` (${takes})` : ''}`;
    }
    if (own) {
      const near = nearestNames(flag, own)[0];
      return `--${flag} is not a flag of ${command}${near !== undefined ? `; did you mean --${near}?` : ''} (${takes ?? ''})`;
    }
  }
  return undefined;
}
