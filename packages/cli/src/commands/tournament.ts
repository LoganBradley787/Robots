import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Bounds, DuelReport, Side } from './duel';

/**
 * The speed rule (docs/plans/titans-tournament.md): a titan against a copy of itself must average under SPEED_AVG_MS
 * per tick. A 95th percentile over SPEED_P95_MS is only a warning (a volley's first seconds may peak).
 */
export const SPEED_AVG_MS = 16;
export const SPEED_P95_MS = 33;
/** Points for a win and for a draw; a loss is 0. */
export const WIN_POINTS = 1;
export const DRAW_POINTS = 0.5;

export interface Titan {
  /** A blueprint name in blueprints/, or a path to a .json file. */
  name: string;
  /** The core's spawn height; on the ground when absent. */
  y?: number;
}

/** One duel to run: `a` on the left. `speed` is a titan against a copy of itself, run alone for its timing. */
export interface MatchSpec {
  kind: 'speed' | 'match';
  a: Titan;
  b: Titan;
  seed: number;
}

export interface MatchResult {
  kind: 'speed' | 'match';
  a: string;
  b: string;
  seed: number;
  /** How long the duel took to run here, seconds. */
  wallSeconds: number;
  report?: DuelReport;
  /** Why the duel did not run (a refused spawn spot, a broken blueprint). */
  error?: string;
}

export interface TournamentOptions {
  seeds: readonly number[];
  seconds: number;
  /** The speed checks' length in place of `seconds` (a mirror match is often a draw, so it runs the full time). */
  speedSeconds?: number;
  /** Duels run at once. The speed checks always run one at a time. */
  jobs: number;
  /** Only the pairings (and speed check) with this titan. */
  only?: string;
  /** A world file's path, in place of the arena. */
  world?: string;
  /** The bounds in place of the default; false for none. */
  bounds?: Bounds | false;
}

export interface TournamentResult {
  titans: Titan[];
  seeds: number[];
  seconds: number;
  jobs: number;
  only?: string;
  world?: string;
  bounds?: Bounds | false;
  wallSeconds: number;
  speed: MatchResult[];
  matches: MatchResult[];
}

export type MatchRunner = (m: MatchSpec, opts: Pick<TournamentOptions, 'seconds' | 'world' | 'bounds'>) => Promise<MatchResult>;

/** `{ "titans": [ { "name": "titan-x", "y": 40 }, ... ] }`; `y` may be left out. */
export function parseRoster(raw: unknown): Titan[] {
  const list = (raw as { titans?: unknown } | null)?.titans;
  if (!Array.isArray(list)) throw new Error('a roster is { "titans": [ { "name": "titan-x", "y": 40 }, ... ] }');
  const out: Titan[] = [];
  for (const t of list as unknown[]) {
    const { name, y } = (t ?? {}) as { name?: unknown; y?: unknown };
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`roster: every titan needs a name, got ${JSON.stringify(t)}`);
    if (y !== undefined && (typeof y !== 'number' || !Number.isFinite(y))) throw new Error(`roster: ${name}'s y must be a number, got ${JSON.stringify(y)}`);
    if (out.some((o) => o.name === name)) throw new Error(`roster: ${name} is listed twice`);
    out.push({ name, ...(y !== undefined ? { y } : {}) });
  }
  return out;
}

/**
 * Every duel of a round robin: each titan against a copy of itself once (seed 1, the speed check), then every pair,
 * each seed, both ways round (the world's boxes are not symmetric, so the left side is not the right side).
 */
export function schedule(titans: readonly Titan[], seeds: readonly number[], only?: string): { speed: MatchSpec[]; matches: MatchSpec[] } {
  if (only !== undefined && !titans.some((t) => t.name === only)) throw new Error(`--only ${only}: the roster has no titan of that name (it has ${titans.map((t) => t.name).join(', ') || 'none'})`);
  const speed: MatchSpec[] = titans.filter((t) => only === undefined || t.name === only).map((t) => ({ kind: 'speed', a: t, b: t, seed: 1 }));
  const matches: MatchSpec[] = [];
  for (let i = 0; i < titans.length; i++) {
    for (let j = i + 1; j < titans.length; j++) {
      const a = titans[i] as Titan;
      const b = titans[j] as Titan;
      if (only !== undefined && a.name !== only && b.name !== only) continue;
      for (const seed of seeds) matches.push({ kind: 'match', a, b, seed }, { kind: 'match', a: b, b: a, seed });
    }
  }
  return { speed, matches };
}

const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Runs one duel as `pnpm sim duel a b --json` in a process of its own, so duels can run side by side. */
export const childDuel: MatchRunner = (m, opts) => {
  const args = ['--import', 'tsx', MAIN, 'duel', m.a.name, m.b.name, '--seed', String(m.seed), '--seconds', String(opts.seconds), '--json'];
  if (opts.world !== undefined) args.push('--world', opts.world);
  if (opts.bounds !== undefined) args.push('--bounds', opts.bounds === false ? 'off' : `${opts.bounds.x},${opts.bounds.y}`);
  if (m.a.y !== undefined) args.push('--ya', String(m.a.y));
  if (m.b.y !== undefined) args.push('--yb', String(m.b.y));
  const started = performance.now();
  return new Promise((done) => {
    const finish = (rest: Pick<MatchResult, 'report' | 'error'>): void => done({ kind: m.kind, a: m.a.name, b: m.b.name, seed: m.seed, wallSeconds: (performance.now() - started) / 1000, ...rest });
    // From the cli package, where tsx is installed; paths in the roster stay relative to where the user typed the command.
    const child = spawn(process.execPath, args, { cwd: CLI_DIR, env: { ...process.env, INIT_CWD: process.env.INIT_CWD ?? process.cwd() }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => finish({ error: e.message }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ error: `${err}${out}`.trim() || `the duel ended with code ${String(code)}` });
      try {
        finish({ report: JSON.parse(out) as DuelReport });
      } catch {
        finish({ error: `the duel printed no result: ${`${err}${out}`.trim().slice(0, 400)}` });
      }
    });
  });
};

/** A speed check's verdict: too slow on the average, a warning on the 95th percentile, or ok. */
export function speedVerdict(r: DuelReport): string {
  if (r.timing.avgMs > SPEED_AVG_MS) return `TOO SLOW: average ${r.timing.avgMs.toFixed(1)} ms is over ${SPEED_AVG_MS}`;
  if (r.timing.p95Ms > SPEED_P95_MS) return `ok (warning: 95th percentile ${r.timing.p95Ms.toFixed(1)} ms is over ${SPEED_P95_MS})`;
  return 'ok';
}

function progress(done: number, of: number, r: MatchResult): string {
  const head = `${r.kind === 'speed' ? 'speed' : 'match'} ${done}/${of}`;
  const stops = r.report?.scriptCrashes ?? [];
  const stopped = stops.length > 0 ? `  scripts stopped: ${(['a', 'b'] as const).map((k) => `${k} ${stops.filter((c) => c.side === k).length}`).join(', ')}` : '';
  const took = `${stopped}  [${r.wallSeconds.toFixed(0)} s]`;
  if (!r.report) return `${head}  ${r.a} against ${r.kind === 'speed' ? 'itself' : r.b}: did not run: ${(r.error ?? '').split('\n')[0] ?? ''}${took}`;
  const t = r.report.timing;
  if (r.kind === 'speed') return `${head}  ${r.a} against itself: ${t.avgMs.toFixed(2)} ms average, ${t.p95Ms.toFixed(2)} ms 95th percentile: ${speedVerdict(r.report)}${took}`;
  const w = r.report.winner;
  return `${head}  a ${r.a} against b ${r.b}, seed ${r.seed}: ${w === 'draw' ? 'draw' : `${w === 'a' ? r.a : r.b} wins`} (${r.report.why})${took}`;
}

/**
 * Runs the tournament: the speed checks first, one at a time (timing is noisy with other duels running), then the
 * pairings, `jobs` at once. Results come back in schedule order whatever order they finished in.
 */
export async function runTournament(titans: readonly Titan[], opts: TournamentOptions, run: MatchRunner = childDuel, log: (line: string) => void = (l) => console.log(l)): Promise<TournamentResult> {
  const started = performance.now();
  const plan = schedule(titans, opts.seeds, opts.only);
  const speed: MatchResult[] = [];
  for (const m of plan.speed) {
    const r = await run(m, { ...opts, seconds: opts.speedSeconds ?? opts.seconds });
    speed.push(r);
    log(progress(speed.length, plan.speed.length, r));
  }
  const matches = new Array<MatchResult>(plan.matches.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < plan.matches.length) {
      const i = next++;
      const r = await run(plan.matches[i] as MatchSpec, opts);
      matches[i] = r;
      log(progress(++done, plan.matches.length, r));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.jobs, plan.matches.length)) }, worker));
  return {
    titans: [...titans],
    seeds: [...opts.seeds],
    seconds: opts.seconds,
    jobs: opts.jobs,
    ...(opts.only !== undefined ? { only: opts.only } : {}),
    ...(opts.world !== undefined ? { world: opts.world } : {}),
    ...(opts.bounds !== undefined ? { bounds: opts.bounds } : {}),
    wallSeconds: (performance.now() - started) / 1000,
    speed,
    matches,
  };
}

export interface Standing {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** 1 for a win, a half for a draw. */
  points: number;
  /** Its share of starting parts alive at the end, averaged over its matches. */
  shareKept: number;
  /** Average match length, seconds. */
  length: number;
}

/** One titan's view of a match it was in. */
interface Seen {
  other: string;
  side: Side;
  seed: number;
  result: 'win' | 'draw' | 'loss';
  report: DuelReport;
}

function seenBy(name: string, matches: readonly MatchResult[]): Seen[] {
  const out: Seen[] = [];
  for (const m of matches) {
    if (!m.report || m.kind !== 'match' || (m.a !== name && m.b !== name)) continue;
    const side: Side = m.a === name ? 'a' : 'b';
    const w = m.report.winner;
    out.push({ other: side === 'a' ? m.b : m.a, side, seed: m.seed, result: w === 'draw' ? 'draw' : w === side ? 'win' : 'loss', report: m.report });
  }
  return out;
}

/** The ranking: most points first, then wins, then share kept, then name. */
export function standings(result: Pick<TournamentResult, 'titans' | 'matches'>): Standing[] {
  const rows = result.titans.map((t): Standing => {
    const seen = seenBy(t.name, result.matches);
    const n = seen.length;
    const count = (r: Seen['result']): number => seen.filter((s) => s.result === r).length;
    const mean = (f: (s: Seen) => number): number => (n > 0 ? seen.reduce((sum, s) => sum + f(s), 0) / n : 0);
    return { name: t.name, played: n, wins: count('win'), draws: count('draw'), losses: count('loss'), points: WIN_POINTS * count('win') + DRAW_POINTS * count('draw'), shareKept: mean((s) => s.report[s.side].share), length: mean((s) => s.report.length) };
  });
  return rows.sort((p, q) => q.points - p.points || q.wins - p.wins || q.shareKept - p.shareKept || (p.name < q.name ? -1 : 1));
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)];
}

const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** For a titan: who beat it, how often, and how (its main core destroyed, or out of bounds). */
export function whatBeat(name: string, matches: readonly MatchResult[]): string[] {
  const seen = seenBy(name, matches);
  const out: string[] = [];
  for (const other of [...new Set(seen.map((s) => s.other))]) {
    const games = seen.filter((s) => s.other === other);
    const lost = games.filter((s) => s.result === 'loss');
    if (lost.length === 0) continue;
    const how: string[] = [];
    for (const [by, text] of [['core', 'its main core destroyed'], ['bounds', 'out of bounds']] as const) {
      const these = lost.filter((s) => s.report[s.side].lostBy === by);
      if (these.length === 0) continue;
      const mean = (f: (s: Seen) => number): number => these.reduce((sum, s) => sum + f(s), 0) / these.length;
      const kept = `it had ${pct(mean((s) => s.report[s.side].share))} of its parts left, the winner ${pct(mean((s) => s.report[s.side === 'a' ? 'b' : 'a'].share))}`;
      how.push(`${text} in ${these.length}, at ${mean((s) => s.report[s.side].lostAt ?? 0).toFixed(0)} s on average; ${kept}`);
    }
    out.push(`${other}: lost ${lost.length} of ${games.length} (${how.join('; ')})`);
  }
  return out;
}

/** A titan's scripts that stopped, over its matches and its speed check: which, on what, why, and in how many duels. */
export function stoppedScripts(name: string, result: Pick<TournamentResult, 'speed' | 'matches'>): string[] {
  const duels = new Map<string, Set<MatchResult>>();
  for (const m of [...result.speed, ...result.matches]) {
    for (const c of m.report?.scriptCrashes ?? []) {
      if ((c.side === 'a' ? m.a : m.b) !== name) continue;
      const key = `${c.script} on ${c.main ? 'the robot with its main core' : 'a piece or copy'} (${c.kind}): ${c.message}`;
      duels.set(key, (duels.get(key) ?? new Set()).add(m));
    }
  }
  return [...duels].map(([key, set]) => `${key}, in ${set.size} duel${set.size === 1 ? '' : 's'}`);
}

/** The ranking table alone, for the end of the run's output. */
export function rankingTable(result: Pick<TournamentResult, 'titans' | 'matches'>): string[] {
  return table(
    ['#', 'titan', 'played', 'wins', 'draws', 'losses', 'points', 'share kept', 'match length'],
    standings(result).map((s, i) => [String(i + 1), s.name, String(s.played), String(s.wins), String(s.draws), String(s.losses), String(s.points), pct(s.shareKept), `${s.length.toFixed(0)} s`]),
  );
}

/** The speed check table: ms per tick of each titan against a copy of itself. */
export function speedTable(result: Pick<TournamentResult, 'speed'>): string[] {
  return table(
    ['titan', 'average ms', '95th ms', 'worst ms', 'scripts ms', 'rest ms', 'verdict'],
    result.speed.map((r) => {
      if (!r.report) return [r.a, '', '', '', '', '', `did not run: ${(r.error ?? '').split('\n')[0] ?? ''}`];
      const t = r.report.timing;
      return [r.a, t.avgMs.toFixed(2), t.p95Ms.toFixed(2), t.worstMs.toFixed(2), t.scriptMs.toFixed(2), t.restMs.toFixed(2), speedVerdict(r.report)];
    }),
  );
}

/** `results.md`: the ranking, every pair, the speed checks, and what beat each titan. */
export function formatResults(result: TournamentResult): string {
  const names = result.titans.map((t) => t.name);
  const lines = [
    '# Tournament results',
    '',
    `${names.length} titans, seeds ${result.seeds.join(', ')}, up to ${result.seconds} s a match, ${result.matches.length} matches${result.only !== undefined ? ` (only those with ${result.only})` : ''}, ${result.jobs} at once${result.world !== undefined ? `, on ${result.world}` : ''}. Took ${result.wallSeconds.toFixed(0)} s.`,
    '',
    '## Ranking',
    '',
    `${WIN_POINTS} point for a win, ${DRAW_POINTS} for a draw (time running out with both main cores alive is a draw). Ranked by points, then wins, then share kept: its starting parts still alive at the end (leaving out those that ended themselves), averaged over its matches.`,
    '',
    ...rankingTable(result),
    '',
    '## Pair by pair',
    '',
    'Wins, draws, and losses of the titan on the left against the titan on top, over every seed and both sides.',
    '',
    ...table(
      ['', ...names],
      names.map((row) => [
        row,
        ...names.map((col) => {
          if (row === col) return '';
          const games = seenBy(row, result.matches).filter((s) => s.other === col);
          const count = (r: Seen['result']): number => games.filter((s) => s.result === r).length;
          return games.length === 0 ? '' : `${count('win')}-${count('draw')}-${count('loss')}`;
        }),
      ]),
    ),
    '',
    '## Speed check',
    '',
    `Each titan against a copy of itself (seed 1), run alone before the matches. The rule: average at most ${SPEED_AVG_MS} ms per tick. A 95th percentile over ${SPEED_P95_MS} ms is a warning only.`,
    '',
    ...speedTable(result),
    '',
    '## What beat it',
  ];
  for (const name of names) {
    const beat = whatBeat(name, result.matches);
    lines.push('', `### ${name}`, '', ...(beat.length > 0 ? beat.map((b) => `- ${b}`) : ['- nothing beat it']));
    const seen = seenBy(name, result.matches);
    const drawn = [...new Set(seen.map((s) => s.other))].flatMap((other) => {
      const games = seen.filter((s) => s.other === other);
      const n = games.filter((s) => s.result === 'draw').length;
      return n > 0 ? [`${other} (${n} of ${games.length})`] : [];
    });
    if (drawn.length > 0) lines.push(`- drew with: ${drawn.join(', ')}`);
    lines.push(...stoppedScripts(name, result).map((c) => `- script stopped: ${c}`));
  }
  const failed = [...result.speed, ...result.matches].filter((m) => m.error !== undefined);
  if (failed.length > 0) {
    lines.push('', '## Matches that did not run', '', 'These count for nobody.', '');
    for (const m of failed) lines.push(`- ${m.kind === 'speed' ? `speed check of ${m.a}` : `a ${m.a} against b ${m.b}, seed ${m.seed}`}: ${(m.error ?? '').split('\n')[0] ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}
