import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { defaultRegistry } from '../src/parts/registry';
import { validateBlueprint } from '../src/blueprint/validate';
import { parseWorldFile } from '../src/world/WorldFile';
import type { Robot } from '../src/world/Robot';

/** Open sky and a floor far below, so a robot at y 200 only feels gravity and its parts. */
const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

const hold = (robot: number, ...keys: string[]) => [{ robot, pressed: keys, released: [] }];
/** The swivel keys: J tilts fully counterclockwise, K fully clockwise, H half of J. */
const SWIVEL_KEYS = [
  { key: 'j', mode: 'hold', target: 'swivelthruster', channel: 'swivel', value: 1 },
  { key: 'k', mode: 'hold', target: 'swivelthruster', channel: 'swivel', value: -1 },
  { key: 'h', mode: 'hold', target: 'swivelthruster', channel: 'swivel', value: 0.5 },
];
/** The thruster sits left of the core, so its push acts off the center of mass: a tilt also turns the robot. */
const SWIVEL = { format: 1, name: 'swivel', grid: ['V^ C'], bindings: SWIVEL_KEYS };
/** Core 2 kg plus the thruster's 1.5. */
const MASS = 3.5;
/** The thruster hangs straight under the core: a straight push passes through the center of mass. */
const TAIL = { format: 1, name: 'tail', grid: ['C', 'V^'], bindings: SWIVEL_KEYS };
const BOOSTER = { format: 1, name: 'booster', grid: ['K^ C'] };

function coreState(w: World, r: Robot) {
  const core = r.parts.get(r.primaryCoreId ?? r.rootId);
  const group = r.groups[core?.group ?? 0];
  if (!group) throw new Error('no core group');
  return w.physics.state(group.bodyId);
}

/** Robot state after `ticks` ticks with `keys` held from the first tick. */
async function fly(bp: unknown, keys: string[], ticks: number) {
  const w = await World.create({ seed: 1 }, open);
  const r = w.spawnBlueprint(bp, { x: 0, y: 200 });
  w.step(hold(r.id, ...keys));
  for (let i = 1; i < ticks; i++) w.step();
  const s = { ...coreState(w, r) };
  w.dispose();
  return { s, mass: MASS };
}

describe('swiveling thruster (Batch)', () => {
  it('is a 400 N, 60 J/s, 1.5 kg booster-like part with a swivel of 15 degrees and a swivel input', () => {
    const d = defaultRegistry().get('swivelthruster');
    expect(d).toMatchObject({ mass: 1.5, health: 25, powerDraw: 60, acts: 'N' });
    expect(d.behaviorConfig).toEqual({ maxForce: 400, swivel: 15 });
    expect(d.inputs.map((c) => [c.name, c.min, c.max, c.default])).toEqual([['throttle', 0, 1, 0], ['swivel', -1, 1, 0]]);
    expect(d.autoControl).toEqual({ channel: 'throttle', kind: 'push' });
  });

  it('with no swivel it matches a booster exactly', async () => {
    const a = await fly(SWIVEL, ['w'], 90);
    const b = await fly(BOOSTER, ['w'], 90);
    expect(a.s).toEqual(b.s);
    // It did push: a robot left to fall for 1.5 s would be moving at about -14.7 m/s, and this one is not.
    expect(a.s.vy).toBeGreaterThan(-14);
  });

  it('full swivel sends 400 sin(15 deg) sideways and 400 cos(15 deg) up, and turns the robot', async () => {
    const still = await fly(SWIVEL, [], 1);
    const tilted = await fly(SWIVEL, ['w', 'j'], 1);
    const dt = 1 / 60;
    const F = 400;
    const rad = (15 * Math.PI) / 180;
    // Counterclockwise: an upward push tilts to the left (negative x).
    expect((tilted.s.vx - still.s.vx) * tilted.mass).toBeCloseTo(-F * Math.sin(rad) * dt, 2);
    expect((tilted.s.vy - still.s.vy) * tilted.mass).toBeCloseTo(F * Math.cos(rad) * dt, 2);
    // The thruster is a meter left of the core, so it pushes on an arm: the robot turns (a lever, not just a shove).
    expect(Math.abs(tilted.s.w - still.s.w)).toBeGreaterThan(0);
  });

  it('swivel is proportional and signed: half swivel is half the angle, negative goes the other way', async () => {
    const still = await fly(SWIVEL, [], 1);
    const full = await fly(SWIVEL, ['w', 'j'], 1);
    const half = await fly(SWIVEL, ['w', 'h'], 1);
    const back = await fly(SWIVEL, ['w', 'k'], 1);
    const dx = (r: { s: { vx: number } }) => r.s.vx - still.s.vx;
    const rad = (15 * Math.PI) / 180;
    expect(dx(half) / dx(full)).toBeCloseTo(Math.sin(rad / 2) / Math.sin(rad), 2);
    expect(dx(back)).toBeCloseTo(-dx(full), 6);
  });

  it('a tilted push turns the robot by its torque about the center of mass', async () => {
    // The thruster hangs straight under the core, so a straight push passes through the center of mass (no spin).
    // Tilting it counterclockwise pushes the tail left, which spins the robot clockwise (negative w); clockwise, the reverse.
    const straight = await fly(TAIL, ['w'], 1);
    const left = await fly(TAIL, ['w', 'j'], 1);
    const right = await fly(TAIL, ['w', 'k'], 1);
    expect(Math.abs(straight.s.w)).toBeLessThan(1e-9);
    expect(left.s.w).toBeLessThan(-0.01);
    expect(right.s.w).toBeCloseTo(-left.s.w, 9);
    expect(Math.sign(left.s.vx)).toBe(-1);
  });

  it('a part without throttle does nothing whatever the swivel', async () => {
    const still = await fly(SWIVEL, [], 30);
    const tilted = await fly(SWIVEL, ['j'], 30);
    expect(tilted.s).toEqual(still.s);
  });

  it('validates and builds from the default legend (V^ Vv V< V>)', () => {
    const reg = defaultRegistry();
    const bp = { format: 1, name: 'v', grid: ['.   Vv  .', 'V>  C   V<'] };
    const r = validateBlueprint(bp, reg);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
