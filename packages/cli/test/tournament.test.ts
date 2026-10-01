import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import { duel, verdict, type DuelReport, type SideReport } from '../src/commands/duel';
import { childDuel, formatResults, parseRoster, runTournament, schedule, speedVerdict, standings, stoppedScripts, whatBeat, type MatchResult, type MatchRunner, type MatchSpec } from '../src/commands/tournament';

const titans = [{ name: 'ant', y: 40 }, { name: 'bee' }, { name: 'cat' }];

type SideSpec = { share: number; lostAt?: number; lostBy?: 'core' | 'bounds' };

/** A duel's report as far as the tables read it. */
function report(a: SideSpec, b: SideSpec, length = 240, timing = { avgMs: 4, p95Ms: 6 }): DuelReport {
  const side = (s: SideSpec, team: number): SideReport => ({ name: 'x', team, at: { x: 0, y: 0 }, startCores: 1, startParts: 100, cores: 1, parts: s.share * 100, share: s.share, robots: 1, spent: 0, copies: 0, ...(s.lostAt !== undefined ? { lostAt: s.lostAt, lostBy: s.lostBy ?? 'core' } : {}) });
  const [ra, rb] = [side(a, 0), side(b, 1)];
  return { world: 'arena', a: ra, b: rb, seed: 1, seconds: 240, length, ticks: length * 60, ...verdict(ra, rb), samples: [], bounds: { x: 1000, y: 250 }, scriptCrashes: [], timing: { ...timing, worstMs: 20, scriptMs: 1, restMs: timing.avgMs - 1, callsPerTick: 2 }, finalHash: '00000000' };
}

const match = (a: string, b: string, seed: number, r: DuelReport | string): MatchResult => ({ kind: 'match', a, b, seed, wallSeconds: 1, ...(typeof r === 'string' ? { error: r } : { report: r }) });

describe('parseRoster', () => {
  it('reads names and optional heights', () => {
    expect(parseRoster({ titans: [{ name: 'ant', y: 40 }, { name: 'bee' }] })).toEqual([{ name: 'ant', y: 40 }, { name: 'bee' }]);
    expect(parseRoster({ titans: [] })).toEqual([]);
  });

  it('refuses a roster it cannot read, saying what is wrong', () => {
    expect(() => parseRoster([])).toThrow(/a roster is \{ "titans"/);
    expect(() => parseRoster({ titans: [{ y: 3 }] })).toThrow(/every titan needs a name/);
    expect(() => parseRoster({ titans: [{ name: 'ant', y: 'high' }] })).toThrow(/ant's y must be a number/);
    expect(() => parseRoster({ titans: [{ name: 'ant' }, { name: 'ant' }] })).toThrow(/ant is listed twice/);
  });
});

describe('schedule', () => {
  it('every pair, each seed, both ways round, and each titan against itself once on seed 1', () => {
    const s = schedule(titans, [1, 2]);
    expect(s.speed.map((m) => `${m.a.name}-${m.b.name}-${m.seed}`)).toEqual(['ant-ant-1', 'bee-bee-1', 'cat-cat-1']);
    expect(s.matches.map((m) => `${m.a.name}-${m.b.name}-${m.seed}`)).toEqual(['ant-bee-1', 'bee-ant-1', 'ant-bee-2', 'bee-ant-2', 'ant-cat-1', 'cat-ant-1', 'ant-cat-2', 'cat-ant-2', 'bee-cat-1', 'cat-bee-1', 'bee-cat-2', 'cat-bee-2']);
    // The height goes with the titan, whichever side it is on.
    expect(s.matches[1]).toEqual({ kind: 'match', a: { name: 'bee' }, b: { name: 'ant', y: 40 }, seed: 1 });
  });

  it('--only keeps the pairings and the speed check of one titan', () => {
    const s = schedule(titans, [1], 'cat');
    expect(s.speed.map((m) => m.a.name)).toEqual(['cat']);
    expect(s.matches.map((m) => `${m.a.name}-${m.b.name}`)).toEqual(['ant-cat', 'cat-ant', 'bee-cat', 'cat-bee']);
    expect(() => schedule(titans, [1], 'dog')).toThrow(/--only dog: the roster has no titan of that name \(it has ant, bee, cat\)/);
  });
});

describe('runTournament', () => {
  it('runs the speed checks alone first, then the pairings at most --jobs at once, and keeps schedule order', async () => {
    let running = 0;
    let most = 0;
    let mostDuringSpeed = 0;
    const order: string[] = [];
    const run: MatchRunner = async (m: MatchSpec) => {
      running++;
      if (m.kind === 'speed') mostDuringSpeed = Math.max(mostDuringSpeed, running);
      most = Math.max(most, running);
      order.push(m.kind);
      // Later matches finish sooner, so finish order is not schedule order.
      await new Promise((r) => setTimeout(r, m.kind === 'speed' ? 1 : 12 - order.length));
      running--;
      const r = report({ share: 1 }, { share: 0.5, lostAt: 3 });
      if (m.a.name === 'bee') r.scriptCrashes.push({ side: 'a', robot: 1, main: true, script: 'pilot', t: 2, kind: 'throw', message: 'boom' });
      return { ...match(m.a.name, m.b.name, m.seed, r), kind: m.kind };
    };
    const lines: string[] = [];
    const r = await runTournament(titans, { seeds: [1], seconds: 5, jobs: 3 }, run, (l) => lines.push(l));
    expect(order.slice(0, 3)).toEqual(['speed', 'speed', 'speed']);
    expect(mostDuringSpeed).toBe(1);
    expect(most).toBe(3);
    expect(r.matches.map((m) => `${m.a}-${m.b}`)).toEqual(['ant-bee', 'bee-ant', 'ant-cat', 'cat-ant', 'bee-cat', 'cat-bee']);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toMatch(/^speed 1\/3 {2}ant against itself: 4\.00 ms average, 6\.00 ms 95th percentile: ok/);
    expect(lines.filter((l) => /^match \d\/6 {2}a \w+ against b \w+, seed 1: \w+ wins \(/.test(l))).toHaveLength(6);
    expect(r).toMatchObject({ seeds: [1], seconds: 5, jobs: 3 });
    // A stopped script shows as each duel finishes.
    expect(lines.filter((l) => l.includes('scripts stopped: a 1, b 0'))).toHaveLength(3);
    expect(lines[1]).toMatch(/^speed 2\/3 {2}bee against itself: .* ok {2}scripts stopped: a 1, b 0 {2}\[/);
  });

  it('runs a duel in a process of its own and reads its result (the same hash as in this process)', { timeout: 60_000 }, async () => {
    const car = { name: 'car' };
    const r = await childDuel({ kind: 'match', a: car, b: car, seed: 2 }, { seconds: 1 });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ kind: 'match', a: 'car', b: 'car', seed: 2 });
    const here = await duel({ name: 'car', raw: carJson }, { name: 'car', raw: carJson }, { seed: 2, seconds: 1 });
    expect(r.report?.finalHash).toBe(here.finalHash);
    expect(r.report?.ticks).toBe(60);
  });

  it('hands the bounds on to the duel', { timeout: 60_000 }, async () => {
    const car = { name: 'car' };
    const off = await childDuel({ kind: 'match', a: car, b: car, seed: 1 }, { seconds: 0.5, bounds: false });
    expect(off.report?.bounds).toBe(false);
    // A core starts 400 m out, so with bounds 300 m to either side both have lost on the first tick: a draw.
    const tight = await childDuel({ kind: 'match', a: car, b: car, seed: 1 }, { seconds: 5, bounds: { x: 300, y: 250 } });
    expect(tight.report).toMatchObject({ winner: 'draw', bounds: { x: 300, y: 250 }, a: { lostBy: 'bounds' }, b: { lostBy: 'bounds' } });
  });

  it('a duel that cannot start comes back with why', { timeout: 60_000 }, async () => {
    const r = await childDuel({ kind: 'match', a: { name: 'car', y: 0.2 }, b: { name: 'car' }, seed: 1 }, { seconds: 1 });
    expect(r.report).toBeUndefined();
    expect(r.error).toContain('car cannot spawn with its core at (-400, 0.2): below the ground');
  });
});

describe('results', () => {
  // ant beats bee twice; ant and cat run out of time once, and cat wins once as ant leaves the bounds; bee against cat never ran.
  const matches = [
    match('ant', 'bee', 1, report({ share: 0.9 }, { share: 0.2, lostAt: 80 }, 82)),
    match('bee', 'ant', 1, report({ share: 0.1, lostAt: 100 }, { share: 0.8 }, 102)),
    match('ant', 'cat', 1, report({ share: 0.7 }, { share: 0.3 })),
    match('cat', 'ant', 1, report({ share: 0.9 }, { share: 0.4, lostAt: 198, lostBy: 'bounds' }, 200)),
    match('bee', 'cat', 1, 'cat cannot spawn with its core at (400, 0.2): below the ground'),
  ];
  const speed: MatchResult[] = [
    { kind: 'speed', a: 'ant', b: 'ant', seed: 1, wallSeconds: 3, report: report({ share: 1 }, { share: 1 }, 240, { avgMs: 20, p95Ms: 40 }) },
    { kind: 'speed', a: 'bee', b: 'bee', seed: 1, wallSeconds: 3, report: report({ share: 1 }, { share: 1 }) },
    { kind: 'speed', a: 'cat', b: 'cat', seed: 1, wallSeconds: 3, report: report({ share: 1 }, { share: 1 }, 240, { avgMs: 9, p95Ms: 40 }) },
  ];
  // bee's pilot stops in both its matches with ant and in its speed check; a copy's guide stops once.
  for (const m of [matches[0], matches[1], speed[1]]) {
    const side = m?.a === 'bee' ? 'a' : 'b';
    m?.report?.scriptCrashes.push({ side, robot: 1, main: true, script: 'pilot', t: 2, kind: 'throw', message: 'boom' });
  }
  matches[0]?.report?.scriptCrashes.push({ side: 'b', robot: 9, main: false, core: 'core@1,1', script: 'guide', t: 30, kind: 'budget', message: 'ran too long' });
  const result = { titans, seeds: [1], seconds: 240, jobs: 4, wallSeconds: 90, speed, matches };

  it('ranks by points (1 for a win, a half for a draw), with share kept and match length averaged', () => {
    const rows = standings(result);
    expect(rows.map((r) => [r.name, r.played, r.wins, r.draws, r.losses, r.points])).toEqual([
      ['ant', 4, 2, 1, 1, 2.5],
      ['cat', 2, 1, 1, 0, 1.5],
      ['bee', 2, 0, 0, 2, 0],
    ]);
    expect(rows[0]?.shareKept).toBeCloseTo((0.9 + 0.8 + 0.7 + 0.4) / 4, 9);
    expect(rows[0]?.length).toBeCloseTo((82 + 102 + 240 + 200) / 4, 9);
    expect(rows[2]?.length).toBe(92);
  });

  it('a titan over the average is too slow; over the 95th percentile alone is a warning', () => {
    expect(speed.map((s) => speedVerdict(s.report as DuelReport))).toEqual(['TOO SLOW: average 20.0 ms is over 16', 'ok', 'ok (warning: 95th percentile 40.0 ms is over 33)']);
  });

  it('says what beat a titan and how', () => {
    expect(whatBeat('bee', matches)).toEqual(['ant: lost 2 of 2 (its main core destroyed in 2, at 90 s on average; it had 15.0% of its parts left, the winner 85.0%)']);
    expect(whatBeat('ant', matches)).toEqual(['cat: lost 1 of 2 (out of bounds in 1, at 198 s on average; it had 40.0% of its parts left, the winner 90.0%)']);
    expect(whatBeat('cat', matches)).toEqual([]);
  });

  it('lists the scripts of a titan that stopped, and in how many duels', () => {
    expect(stoppedScripts('bee', result)).toEqual(['pilot on the robot with its main core (throw): boom, in 3 duels', 'guide on a piece or copy (budget): ran too long, in 1 duel']);
    expect(stoppedScripts('ant', result)).toEqual([]);
  });

  it('writes the ranking, the pair grid, the speed table, what beat each titan, and what did not run', () => {
    const md = formatResults(result);
    expect(md).toContain('3 titans, seeds 1, up to 240 s a match, 5 matches, 4 at once. Took 90 s.');
    expect(md).toContain('| 1 | ant | 4 | 2 | 1 | 1 | 2.5 | 70.0% | 156 s |');
    expect(md).toContain('|  | ant | bee | cat |');
    expect(md).toContain('| ant |  | 2-0-0 | 0-1-1 |');
    expect(md).toContain('| bee | 0-0-2 |  |  |');
    expect(md).toContain('| ant | 20.00 | 40.00 | 20.00 | 1.00 | 19.00 | TOO SLOW: average 20.0 ms is over 16 |');
    expect(md).toContain('| bee | 4.00 | 6.00 | 20.00 | 1.00 | 3.00 | ok |');
    expect(md).toContain('### cat\n\n- nothing beat it\n- drew with: ant (1 of 2)');
    expect(md).toContain('### bee\n\n- ant: lost 2 of 2');
    expect(md).toContain('- script stopped: pilot on the robot with its main core (throw): boom, in 3 duels');
    expect(md).toContain('- a bee against b cat, seed 1: cat cannot spawn with its core at (400, 0.2): below the ground');
    expect(md).not.toContain('\u2014');
  });
});
