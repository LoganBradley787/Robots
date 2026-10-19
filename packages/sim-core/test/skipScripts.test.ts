import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { buildReplay, parseReplay, ReplayError, runReplay } from '../src/replay/replayFile';

/**
 * Smooth (the app's setting): the app may have a robot's scripts sit out a tick. The world takes the list as input
 * (`skipScripts`), logs it like a key press, and a skipped robot keeps what its scripts set when they last ran.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** Counts its own calls, sets a throttle that changes with the tick, and logs what it saw. */
const COUNT = `function tick() {
  state.n = (state.n || 0) + 1;
  set('thruster', 'throttle', 0.3 + 0.1 * (frame % 4));
  log('n' + state.n + ' f' + frame + ' age ' + self.age.toFixed(4));
}`;

const lifter = (source: string, name = 'lifter'): unknown => ({
  format: 1,
  name,
  grid: ['F  T^ C  T^ F'],
  scripts: [{ id: 'count', enabled: true, source }],
});

const bare = { format: 1, name: 'bare', grid: ['F  C  F'] };

async function world(): Promise<World> {
  return World.create({ seed: 1, scripts: host }, open);
}

const lines = (w: World, robot: number): string[] => w.scriptLogs.filter((l) => l.robot === robot).map((l) => l.text);

describe('skipped scripts (Smooth)', () => {
  it('a skipped robot calls no script and keeps what its scripts set when they last ran', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(COUNT), { x: 0, y: 1 });
    w.step(); // frame 0: 0.3
    w.step(); // frame 1: 0.4
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.4, 9);
    w.skipScripts([r.id]);
    w.step(); // frame 2, skipped: still 0.4, not the 0.5 it would set, nor the default 0
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.4, 9);
    expect(w.channelValue(r.id, 'thruster@3,0', 'throttle')).toBeCloseTo(0.4, 9);
    w.skipScripts([r.id]);
    w.step(); // frame 3, skipped again
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.4, 9);
    w.step(); // frame 4 runs: 0.3, its third call
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeCloseTo(0.3, 9);
    // Its own count counts calls; frame and self.age are the world's, so it sees that ticks went by.
    expect(lines(w, r.id)).toEqual(['n1 f0 age 0.0000', 'n2 f1 age 0.0167', 'n3 f4 age 0.0667']);
    w.dispose();
  });

  it('the skip applies to the next tick only, and is logged like a key press: sorted, only robots with scripts', async () => {
    const w = await world();
    const a = w.spawnBlueprint(lifter(COUNT, 'a'), { x: 0, y: 1 });
    const b = w.spawnBlueprint(lifter(COUNT, 'b'), { x: 20, y: 1 });
    const c = w.spawnBlueprint(bare, { x: 40, y: 1 });
    w.step();
    expect(w.scriptedRobots()).toEqual([a.id, b.id]);
    w.skipScripts([b.id, c.id, a.id]);
    w.step();
    w.step();
    expect(w.inputLog.worldAt(0)).toBeUndefined();
    expect(w.inputLog.worldAt(1)).toEqual({ skip: [a.id, b.id] });
    expect(w.inputLog.worldAt(2)).toBeUndefined();
    expect(lines(w, a.id).map((l) => l.split(' ')[1])).toEqual(['f0', 'f2']);
    expect(() => w.skipScripts([0])).toThrow('robot id');
    w.dispose();
  });

  it('a script switched off while skipped stops driving its parts; one with nothing set yet sets nothing', async () => {
    const w = await world();
    const bp = { format: 1, name: 'keyed', grid: ['F  T^ C  T^ F'], bindings: [{ key: 'g', mode: 'script', script: 'count' }], scripts: [{ id: 'count', enabled: true, source: COUNT }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 1 });
    w.step();
    w.skipScripts([r.id]);
    w.step([{ robot: r.id, pressed: ['g'], released: [] }]);
    expect(w.scripts(r.id)[0]?.enabled).toBe(false);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0);
    // Back on while skipped: it has not run since, so it sets nothing until it does (setup, then tick).
    w.step([{ robot: r.id, pressed: [], released: ['g'] }]);
    w.skipScripts([r.id]);
    w.step([{ robot: r.id, pressed: ['g'], released: [] }]);
    expect(w.scripts(r.id)[0]?.enabled).toBe(true);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0);
    w.step();
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeGreaterThan(0);
    w.dispose();
  });

  it('a replay with skips reruns to the same end, through JSON, and the skips matter', async () => {
    const run = async (skips: boolean): Promise<World> => {
      const w = await world();
      const a = w.spawnBlueprint(lifter(COUNT, 'a'), { x: 0, y: 1 });
      const b = w.spawnBlueprint(lifter(COUNT, 'b'), { x: 20, y: 1 });
      for (let i = 0; i < 240; i++) {
        if (skips && i % 3 === 1) w.skipScripts([a.id]);
        if (skips && i % 4 !== 0) w.skipScripts([b.id]);
        w.step(i === 60 ? [{ robot: a.id, pressed: ['w'], released: [] }] : i === 120 ? [{ robot: a.id, pressed: [], released: ['w'] }] : []);
      }
      return w;
    };
    const w = await run(true);
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(w))));
    expect(replay.inputs.filter((t) => t.world?.skip).length).toBeGreaterThan(150);
    const r = await runReplay(replay, undefined, host);
    expect(r.matches).toBe(true);
    expect(r.world.scriptLogs).toEqual(w.scriptLogs);
    const plain = await run(false);
    expect(plain.hash()).not.toBe(w.hash());
    r.world.dispose();
    plain.dispose();
    w.dispose();
  });

  it('a skipped robot is not watched (nothing of it runs), and with skips a watch still changes nothing', async () => {
    const run = async (watch: boolean): Promise<{ hashes: string[]; calls: number[] }> => {
      const w = await world();
      const calls: number[] = [];
      const a = w.spawnBlueprint(lifter(COUNT, 'a'), { x: 0, y: 1 });
      w.spawnBlueprint(lifter(COUNT, 'b'), { x: 20, y: 1 });
      // A watch that forgets to run still gets the robot run.
      if (watch) w.watchScripts((robot) => void calls.push(-robot));
      w.step();
      const hashes: string[] = [w.hash()];
      for (let i = 0; i < 60; i++) {
        // Running twice does nothing more.
        if (watch && i === 0) w.watchScripts((robot, go) => (calls.push(robot), go(), go()));
        if (watch && i === 1) w.watchScripts((robot, go) => (calls.push(robot), go()));
        if (i === 30) w.skipScripts([a.id]);
        w.step();
        hashes.push(w.hash());
      }
      w.dispose();
      return { hashes, calls };
    };
    const plain = await run(false);
    const watched = await run(true);
    expect(watched.hashes).toEqual(plain.hashes);
    // A skipped robot is not watched: nothing of it runs.
    expect(watched.calls.length).toBe(2 + 60 * 2 - 1);
  });

  it('older replays, without skips, still load; a bad skip list is refused', async () => {
    const w = await world();
    const a = w.spawnBlueprint(lifter(COUNT, 'a'), { x: 0, y: 1 });
    for (let i = 0; i < 30; i++) w.step(i === 5 ? [{ robot: a.id, pressed: ['w'], released: [] }] : []);
    const raw = JSON.parse(JSON.stringify(buildReplay(w))) as { inputs: { world?: unknown }[] };
    expect(raw.inputs.some((t) => t.world !== undefined)).toBe(false);
    const r = await runReplay(parseReplay(raw), undefined, host);
    expect(r.matches).toBe(true);
    r.world.dispose();
    const bad = { ...raw, inputs: [{ tick: 1, inputs: [], world: { skip: [0] } }] };
    expect(() => parseReplay(bad)).toThrow(ReplayError);
    expect(() => parseReplay(bad)).toThrow('inputs[0].world.skip');
    w.dispose();
  });
});
