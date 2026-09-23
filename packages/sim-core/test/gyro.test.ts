import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { sampleRobot } from '../src/metrics/robotMetrics';
import { autoBindings } from '../src/control/autoControls';
import { expandBlueprint } from '../src/blueprint/expand';
import { defaultRegistry } from '../src/parts/registry';
import type { Blueprint } from '../src/blueprint/types';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const FLOATER = { format: 1, name: 'floater', grid: ['F  C  G  F'], legend: { G: { part: 'gyro' } } };

async function space(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0 }, open);
}
const spinOf = (w: World, id: number): number => w.physics.state(w.robots.find((r) => r.id === id)?.groups[0]?.bodyId ?? 0).w;

describe('gyro', () => {
  it('auto controls put spin on E (clockwise) and Q', () => {
    const bp = expandBlueprint(FLOATER).blueprint as Blueprint;
    expect(autoBindings(bp, defaultRegistry()).map((b) => `${b.key}${b.value}`)).toEqual(['e1', 'q-1']);
  });

  it('E spins the robot clockwise, Q counterclockwise', async () => {
    const w = await space();
    const r = w.spawnBlueprint(FLOATER, { x: 0, y: 10 });
    w.step([{ robot: r.id, pressed: ['e'], released: [] }]);
    for (let i = 0; i < 30; i++) w.step();
    expect(spinOf(w, r.id)).toBeLessThan(-1);
    w.step([{ robot: r.id, pressed: ['q'], released: ['e'] }]);
    for (let i = 0; i < 90; i++) w.step();
    expect(spinOf(w, r.id)).toBeGreaterThan(1);
    w.dispose();
  });

  it('letting go damps the spin to a stop, gently', async () => {
    const w = await space();
    const r = w.spawnBlueprint(FLOATER, { x: 0, y: 10 });
    w.step([{ robot: r.id, pressed: ['e'], released: [] }]);
    for (let i = 0; i < 20; i++) w.step();
    w.step([{ robot: r.id, pressed: [], released: ['e'] }]);
    const w0 = Math.abs(spinOf(w, r.id));
    for (let i = 0; i < 10; i++) w.step();
    expect(Math.abs(spinOf(w, r.id))).toBeGreaterThan(w0 * 0.2); // not an instant stop
    for (let i = 0; i < 240; i++) w.step();
    expect(Math.abs(spinOf(w, r.id))).toBeLessThan(0.01);
    w.dispose();
  });

  it('damping can be turned off with a binding on its damp channel', async () => {
    const w = await space();
    const bp = { ...FLOATER, bindings: [{ key: 'k', mode: 'toggle', target: 'gyro', channel: 'damp', value: -1 }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 10 });
    w.step([{ robot: r.id, pressed: ['k', 'e'], released: [] }]);
    for (let i = 0; i < 20; i++) w.step();
    w.step([{ robot: r.id, pressed: [], released: ['e'] }]);
    const w0 = spinOf(w, r.id);
    for (let i = 0; i < 120; i++) w.step();
    // Only air drag slows it now: most of the spin is still there after 2 s (damping stops it in about 1 s).
    expect(Math.abs(spinOf(w, r.id))).toBeGreaterThan(Math.abs(w0) * 0.5);
    w.dispose();
  });

  it('a hopper with a gyro climbs straighter than one without', async () => {
    const tiltAfterHop = async (grid: string[]): Promise<number> => {
      const w = await World.create({ seed: 1 }, open);
      const r = w.spawnBlueprint({ format: 1, name: 'h', grid, legend: { G: { part: 'gyro' } } }, { x: 0, y: 2.45 });
      for (let i = 0; i < 30; i++) w.step();
      w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
      for (let i = 0; i < 150; i++) w.step();
      const t = Math.abs(sampleRobot(w, r).tiltDeg);
      w.dispose();
      return t;
    };
    const plain = await tiltAfterHop(['.  .  .  .  .  .', 'F  T^ C  B  T^ F', 'W  .  .  .  .  W']);
    const steadied = await tiltAfterHop(['.  .  G  .  .  .', 'F  T^ C  B  T^ F', 'W  .  .  .  .  W']);
    expect(steadied).toBeLessThan(plain / 2);
    expect(steadied).toBeLessThan(5);
  });
});
