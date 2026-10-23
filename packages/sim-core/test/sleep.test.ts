import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import { SLEEP_MAX, type ScriptHost } from '../src/script/types';
import { buildReplay, parseReplay, runReplay } from '../src/replay/replayFile';
import { scriptChecks } from '../src/script/checks';
import { loadBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';

/**
 * `sleep(n)`: a script skips its next n ticks (at most SLEEP_MAX). The world calls nothing and makes its last `set()`
 * calls again, as on a tick Smooth skips; it wakes on its own, seeing the world's real time.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** Counts its calls, sets a throttle that changes with the frame, logs what it saw, and sleeps `state.nap` ticks. */
const NAPPER = (nap: string): string => `function tick() {
  state.n = (state.n || 0) + 1;
  set('thruster', 'throttle', 0.3 + 0.1 * (frame % 4));
  mark(frame, 0, 'f');
  log('n' + state.n + ' f' + frame + ' age ' + self.age.toFixed(4));
  sleep(${nap});
}`;

const lifter = (source: string, name = 'lifter'): unknown => ({
  format: 1,
  name,
  grid: ['F  T^ C  T^ F'],
  scripts: [{ id: 'nap', enabled: true, source }],
});

const world = (): Promise<World> => World.create({ seed: 1, scripts: host }, open);
const lines = (w: World, robot: number): string[] => w.scriptLogs.filter((l) => l.robot === robot).map((l) => l.text);
const frames = (w: World, robot: number): string[] => lines(w, robot).map((l) => l.split(' ')[1] ?? '');

describe('sleep(n)', () => {
  it('skips the next n ticks, holds what it set, keeps its marks, and wakes on real time', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(NAPPER('3')), { x: 0, y: 1 });
    w.step(); // frame 0 runs: 0.3, then sleeps frames 1, 2 and 3
    expect(w.scripts(r.id)[0]?.asleep).toBe(3);
    for (let f = 1; f <= 3; f++) {
      w.step();
      expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.3, 9);
      expect(w.channelValue(r.id, 'thruster@3,0', 'throttle')).toBeCloseTo(0.3, 9);
      expect(w.marks(r.id)).toEqual([{ x: 0, y: 0, label: 'f' }]);
    }
    expect(w.scripts(r.id)[0]?.asleep).toBeUndefined();
    w.step(); // frame 4 runs: 0.3 again (4 % 4), its second call
    w.step(); // asleep
    w.step(); // asleep
    w.step(); // asleep
    w.step(); // frame 8
    expect(lines(w, r.id)).toEqual(['n1 f0 age 0.0000', 'n2 f4 age 0.0667', 'n3 f8 age 0.1333']);
    w.dispose();
  });

  it('caps n at SLEEP_MAX, takes whole ticks, and sleeps not at all for 0, a negative or not a number', async () => {
    const cases: [string, string[], string?][] = [
      ['1000', ['f0', `f${SLEEP_MAX + 1}`]],
      ['2.9', ['f0', 'f3', 'f6']],
      ['0', ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6']],
      ['-5', ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6']],
      ['"soon"', ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'], 'sleep(NaN): not a number of ticks; it does not sleep'],
    ];
    for (const [nap, want, warn] of cases) {
      const w = await world();
      const r = w.spawnBlueprint(lifter(NAPPER(nap)), { x: 0, y: 1 });
      for (let i = 0; i <= Math.max(6, SLEEP_MAX + 1); i++) w.step();
      const seen = lines(w, r.id).filter((l) => l.startsWith('n')).map((l) => l.split(' ')[1]);
      expect(seen.slice(0, want.length), nap).toEqual(want);
      if (warn) expect(lines(w, r.id)).toContain(warn);
      w.dispose();
    }
  });

  it('a robot whose scripts all sleep is not one Smooth may skip, and a skipped tick counts as a tick slept', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(NAPPER('2')), { x: 0, y: 1 });
    expect(w.scriptedRobots()).toEqual([r.id]);
    w.step(); // frame 0 runs, sleeps 1 and 2
    expect(w.scriptedRobots()).toEqual([]);
    w.step(); // frame 1 asleep
    w.skipScripts([r.id]);
    w.step(); // frame 2 skipped by Smooth: its last tick asleep is used up all the same
    expect(w.scriptedRobots()).toEqual([r.id]);
    w.step(); // frame 3 runs
    expect(frames(w, r.id)).toEqual(['f0', 'f3']);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.6, 9);
    w.dispose();
  });

  it('a script asleep hashes, and a replay of sleeping scripts matches', async () => {
    const run = async (nap: string): Promise<World> => {
      const w = await world();
      const a = w.spawnBlueprint(lifter(NAPPER(nap), 'a'), { x: 0, y: 1 });
      w.spawnBlueprint(lifter(NAPPER(`frame % 7`), 'b'), { x: 20, y: 1 });
      for (let i = 0; i < 240; i++) {
        if (i % 5 === 2) w.skipScripts([a.id]);
        w.step(i === 60 ? [{ robot: a.id, pressed: ['w'], released: [] }] : i === 120 ? [{ robot: a.id, pressed: [], released: ['w'] }] : []);
      }
      return w;
    };
    const w = await run('3');
    const r = await runReplay(parseReplay(JSON.parse(JSON.stringify(buildReplay(w)))), undefined, host);
    expect(r.matches).toBe(true);
    expect(r.world.hash()).toBe(w.hash());
    expect(r.world.scriptLogs).toEqual(w.scriptLogs);
    r.world.dispose();
    w.dispose();
    // The ticks left asleep are in the hash: two worlds alike but for them hash apart.
    const one = await world();
    const two = await world();
    one.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', 0.5); sleep(4); }`), { x: 0, y: 1 });
    two.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', 0.5); sleep(5); }`), { x: 0, y: 1 });
    one.step();
    two.step();
    expect(one.hash()).not.toBe(two.hash());
    one.dispose();
    two.dispose();
  });

  it('a plain sleep() over the cap is warned about before a run; one in a comment, a string or a variable is not', () => {
    const registry = defaultRegistry();
    const loaded = loadBlueprint(lifter('function tick() {}'), registry);
    const source = `function tick() {\n  sleep(60);\n  sleep(30);\n  // sleep(90)\n  log('sleep(99)');\n  sleep(state.n);\n  obj.sleep(45);\n}`;
    const found = scriptChecks(source, loaded.blueprint, registry).filter((c) => c.kind === 'sleep');
    expect(found.map((c) => [c.line, c.message])).toEqual([[2, `sleep() skips at most ${SLEEP_MAX} ticks, so sleep(60) sleeps ${SLEEP_MAX}. Call it again when it wakes to sleep longer.`]]);
  });
});
