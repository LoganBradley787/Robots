import { describe, expect, it } from 'vitest';
import carJson from '../../../blueprints/car.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { sampleRobot } from '../src/metrics/robotMetrics';
import { defaultRegistry } from '../src/parts/registry';

const wheel = defaultRegistry().get('wheel');
/** The fastest the wheels can roll the car; faster means the solver added energy. */
const RIM_SPEED = (wheel.behaviorConfig?.maxSpeed ?? 0) * (wheel.collider?.radius ?? 0.5) + 0.5;

/**
 * Gate 3: a car driven off a 1 m ledge bounced higher every time and flipped, and a car dropped while holding D
 * flipped on landing. Cause: impulse joints under a slipping, driven wheel. These drives must stay upright and never
 * go faster than the wheels can turn, which would mean the solver is adding energy.
 */
const ledge = parseWorldFile({ name: 'ledge', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: -8, y: 0.5, w: 1, h: 1 }] });
const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

async function hold(file: typeof open, at: { x: number; y: number }, seconds: number): Promise<{ maxTilt: number; top: number }> {
  const w = await World.create({ seed: 1 }, file);
  const car = w.spawnBlueprint(carJson, at);
  w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
  let maxTilt = 0;
  let top = 0;
  for (let i = 0; i < seconds * 60; i++) {
    w.step();
    const s = sampleRobot(w, car);
    maxTilt = Math.max(maxTilt, Math.abs(s.tiltDeg));
    top = Math.max(top, s.speed);
  }
  w.dispose();
  return { maxTilt, top };
}

describe('driving stability', () => {
  it('driving off a ledge from many starting spots stays upright and under wheel speed', async () => {
    for (let k = 0; k <= 12; k++) {
      const x = -6.4 + k * 0.1;
      const r = await hold(ledge, { x, y: 2.7 }, 10);
      expect(r.maxTilt, `start x ${x.toFixed(1)}`).toBeLessThan(45);
      expect(r.top, `start x ${x.toFixed(1)}`).toBeLessThan(RIM_SPEED);
    }
  }, 60_000);

  it('landing from a drop with D held stays upright', async () => {
    for (const y of [3, 5, 8]) {
      const r = await hold(open, { x: 0, y }, 8);
      expect(r.maxTilt, `drop from ${y} m`).toBeLessThan(45);
      expect(r.top, `drop from ${y} m`).toBeLessThan(RIM_SPEED);
    }
  }, 60_000);

  it('a car with one frame corner caught on a block drives off it (Gate 3 screenshot)', async () => {
    for (const overlap of [0.05, 0.3, 0.8]) {
      const w = await World.create({ seed: 1 }, ledge);
      const car = w.spawnBlueprint(carJson, { x: -5 - overlap, y: 1.52 });
      for (let i = 0; i < 90; i++) w.step();
      const x0 = sampleRobot(w, car).coreX;
      w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
      for (let i = 0; i < 240; i++) w.step();
      expect(sampleRobot(w, car).coreX - x0, `overlap ${overlap}`).toBeGreaterThan(10);
      w.dispose();
    }
  });
});
