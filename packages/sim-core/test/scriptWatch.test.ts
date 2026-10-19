import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';

/**
 * The script watch (`World.watchScripts`): the app times each robot's scripts on its own clock. The world hands it a
 * `run` per robot per tick; nothing about the run changes.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const COUNT = `function tick() {
  state.n = (state.n || 0) + 1;
  set('thruster', 'throttle', 0.3 + 0.1 * (frame % 4));
  log('n' + state.n);
}`;

const lifter = (name: string): unknown => ({ format: 1, name, grid: ['F  T^ C  T^ F'], scripts: [{ id: 'count', enabled: true, source: COUNT }] });

describe('the script watch', () => {
  it('changes nothing: each robot runs once a tick, whether the watch runs it, runs it twice, or forgets to', async () => {
    const run = async (watch: boolean): Promise<{ hashes: string[]; logs: unknown[]; calls: number[] }> => {
      const w = await World.create({ seed: 1, scripts: host }, open);
      const calls: number[] = [];
      w.spawnBlueprint(lifter('a'), { x: 0, y: 1 });
      w.spawnBlueprint(lifter('b'), { x: 20, y: 1 });
      // A watch that forgets to run still gets the robot run.
      if (watch) w.watchScripts((robot) => void calls.push(-robot));
      w.step();
      const hashes: string[] = [w.hash()];
      for (let i = 0; i < 60; i++) {
        // Running twice does nothing more.
        if (watch && i === 0) w.watchScripts((robot, go) => (calls.push(robot), go(), go()));
        if (watch && i === 1) w.watchScripts((robot, go) => (calls.push(robot), go()));
        w.step();
        hashes.push(w.hash());
      }
      const logs = w.scriptLogs.map((l) => ({ ...l }));
      w.dispose();
      return { hashes, logs, calls };
    };
    const plain = await run(false);
    const watched = await run(true);
    expect(watched.hashes).toEqual(plain.hashes);
    expect(watched.logs).toEqual(plain.logs);
    expect(watched.calls.length).toBe(2 + 60 * 2);
  });

  it('is off once removed', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    let calls = 0;
    w.spawnBlueprint(lifter('a'), { x: 0, y: 1 });
    w.watchScripts((_robot, go) => (calls++, go()));
    w.step();
    w.watchScripts(undefined);
    w.step();
    expect(calls).toBe(1);
    expect(w.scriptLogs.length).toBe(2);
    w.dispose();
  });
});
