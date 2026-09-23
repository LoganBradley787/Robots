import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { sampleRobot } from '../src/metrics/robotMetrics';

/** M5 done-when: the hover drone holds altitude with its script, A and D tilt it, and an endless loop is contained. */
const DIR = join(__dirname, '../../../blueprints');
const load = (name: string): unknown => resolveScripts(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')), (f) => readFileSync(join(DIR, f), 'utf8')).raw;
const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

describe('the hover drone', () => {
  it('holds its height within 0.5 m for 20 s', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint(load('drone'), { x: 0, y: 3 });
    let worst = 0;
    for (let i = 0; i < 60 * 20; i++) {
      w.step();
      if (i > 60) worst = Math.max(worst, Math.abs(sampleRobot(w, r).coreY - 3));
    }
    expect(worst).toBeLessThan(0.5);
    expect(Math.abs(sampleRobot(w, r).coreX)).toBeLessThan(0.5);
    w.dispose();
  });

  it('A leans it left and it flies left; let go and it stops', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint(load('drone'), { x: 0, y: 3 });
    for (let i = 0; i < 60; i++) w.step();
    w.step([{ robot: r.id, pressed: ['a'], released: [] }]);
    let maxTilt = 0;
    for (let i = 0; i < 120; i++) {
      w.step();
      maxTilt = Math.max(maxTilt, sampleRobot(w, r).tiltDeg);
    }
    expect(maxTilt).toBeGreaterThan(10); // counterclockwise: leaning left
    expect(sampleRobot(w, r).coreX).toBeLessThan(-2);
    w.step([{ robot: r.id, pressed: [], released: ['a'] }]);
    for (let i = 0; i < 60 * 8; i++) w.step();
    const s = sampleRobot(w, r);
    expect(s.speed).toBeLessThan(0.5);
    expect(Math.abs(s.coreY - 3)).toBeLessThan(1);
    w.dispose();
  });

  it('the looper crashes on its first tick; the drone beside it keeps hovering and the world keeps stepping', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const looper = w.spawnBlueprint(load('looper'), { x: -20, y: 1.45 });
    const drone = w.spawnBlueprint(load('drone'), { x: 0, y: 3 });
    for (let i = 0; i < 300; i++) w.step();
    expect(w.tick).toBe(300);
    expect(w.scripts(looper.id)[0]).toMatchObject({ enabled: false, crashed: { kind: 'budget' } });
    expect(w.events).toContainEqual(expect.objectContaining({ kind: 'scriptCrashed', robot: looper.id, tick: 0 }));
    expect(Math.abs(sampleRobot(w, drone).coreY - 3)).toBeLessThan(0.5);
    w.dispose();
  });
});
