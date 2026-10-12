import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const push = [{ key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 }];
/** Six thrusters pushing a slab of frames up; `W` is full throttle. The top rows are there to be shot off. */
const SLAB = {
  format: 1,
  name: 'slab',
  grid: [
    'F F F F F F F F',
    'F F F F F F F F',
    'F F F F F F F F',
    'F F F F F F F F',
    'Z F F C F F F Z',
    'F T^ T^ T^ T^ T^ T^ F',
  ],
  bindings: push,
};
/** The same on two wheels, so its hull is a body with joints. */
const WHEELED = { ...SLAB, name: 'wheeled', grid: [...SLAB.grid.slice(0, 5), 'W T^ T^ T^ T^ T^ T^ W'] };
const speed = (w: World, r: Robot): number => {
  const body = r.groups[r.parts.get(r.primaryCoreId ?? '')?.group ?? 0]?.bodyId as number;
  const s = w.physics.state(body);
  return Math.sqrt(s.vx * s.vx + s.vy * s.vy);
};

/**
 * Flies a blueprint for `ticks`, taking one of its top frames every tick when `lose`. Full throttle goes on at tick
 * `on` (before the first tick by default) and off at tick `off`.
 */
async function fly(blueprint: unknown, ticks: number, lose: boolean, on = -1, off = Infinity): Promise<number> {
  const w = await World.create({ seed: 1, gravityY: 0 }, space);
  const r = w.spawnBlueprint(blueprint, { x: 0, y: 100 });
  w.setUnlimitedEnergy(true);
  w.step(on < 0 ? [{ robot: r.id, pressed: ['w'], released: [] }] : []);
  const spare = [...r.parts.values()].filter((p) => p.def.id === 'frame' && p.y >= 2).map((p) => p.id);
  for (let i = 0; i < ticks; i++) {
    if (lose) {
      const part = r.parts.get(spare[i] as string);
      if (part) part.health = 0;
    }
    w.step(i === on ? [{ robot: r.id, pressed: ['w'], released: [] }] : i === off ? [{ robot: r.id, pressed: [], released: ['w'] }] : []);
  }
  // A hull with joints reports a rebuilt body's velocity a step late: let the last rebuild settle.
  for (let i = 0; i < 3; i++) w.step();
  const v = speed(w, r);
  w.dispose();
  return v;
}

describe('velocity across rebuilds (review S1, S2)', () => {
  it('a robot that loses a part on every tick keeps the speed its thrusters gave it', async () => {
    const whole = await fly(SLAB, 30, false);
    const shot = await fly(SLAB, 30, true);
    expect(whole).toBeGreaterThan(5);
    // Lighter by the lost frames, so if anything a little faster; never the one tick of thrust it used to keep.
    expect(shot).toBeGreaterThan(whole * 0.95);
    expect(shot).toBeLessThan(whole * 1.6);
  });

  it('and so does one whose hull has joints (wheels)', async () => {
    const whole = await fly(WHEELED, 30, false);
    const shot = await fly(WHEELED, 30, true);
    expect(whole).toBeGreaterThan(5);
    expect(shot).toBeGreaterThan(whole * 0.95);
    expect(shot).toBeLessThan(whole * 1.6);
  });

  it('what changes while it is losing parts counts too: thrust that comes on, and thrust that goes off (review of the fix)', async () => {
    for (const blueprint of [SLAB, WHEELED]) {
      const name = (blueprint as { name: string }).name;
      // Throttle on at tick 5 of the streak.
      const onWhole = await fly(blueprint, 30, false, 5);
      const onShot = await fly(blueprint, 30, true, 5);
      expect(onWhole, name).toBeGreaterThan(5);
      expect(onShot, name).toBeGreaterThan(onWhole * 0.95);
      expect(onShot, name).toBeLessThan(onWhole * 2);
      // Throttle off at tick 15.
      const offWhole = await fly(blueprint, 30, false, -1, 15);
      const offShot = await fly(blueprint, 30, true, -1, 15);
      expect(offWhole, name).toBeGreaterThan(3);
      expect(offShot, name).toBeGreaterThan(offWhole * 0.95);
      expect(offShot, name).toBeLessThan(offWhole * 1.3);
    }
  });

  it('the tick after a part loss, a script still reads its own velocity and spin', async () => {
    for (const grid of [['F F F', 'F C F'], ['F F F', 'F C F', 'W . W']]) {
      const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
      const r = w.spawnBlueprint({ format: 1, name: 'flyer', grid, scripts: [{ id: 'read', source: `function tick() { log(self.vel.x.toFixed(2), self.vel.y.toFixed(2), self.angVel.toFixed(2)); }` }] }, { x: 0, y: 100 });
      w.kickRobot(r, 20, 5, 0);
      for (let i = 0; i < 10; i++) w.step();
      const top = [...r.parts.values()].find((p) => p.def.id === 'frame' && p.y === (grid.length - 1) && p.x === 0);
      if (top) top.health = 0;
      const from = w.scriptLogs.length;
      for (let i = 0; i < 4; i++) w.step();
      const read = w.scriptLogs.slice(from).map((l) => l.text.split(' ').map(Number));
      expect(read).toHaveLength(4);
      for (const [vx, vy, spin] of read) {
        expect(vx, `${grid.length} rows: ${JSON.stringify(read)}`).toBeCloseTo(20, 0);
        expect(vy).toBeCloseTo(5, 0);
        expect(Math.abs(spin as number)).toBeLessThan(0.2);
      }
      w.dispose();
    }
  });
});
