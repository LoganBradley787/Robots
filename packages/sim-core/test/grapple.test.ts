import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import grappleJson from '../src/parts/defs/grapple.json';

const flat = parseWorldFile(flatJson);
const press = (robot: number, ...keys: string[]) => [{ robot, pressed: keys, released: [] as string[] }];
const lift = (robot: number, ...keys: string[]) => [{ robot, pressed: [] as string[], released: keys }];
const CONTROLS = [
  { key: 'f', mode: 'hold', target: 'grapple', channel: 'fire', value: 1 },
  { key: 'r', mode: 'hold', target: 'grapple', channel: 'reel', value: 1 },
  { key: 'e', mode: 'hold', target: 'grapple', channel: 'reel', value: -1 },
  { key: 'x', mode: 'hold', target: 'grapple', channel: 'release', value: 1 },
];
/** A core with a grapple on its right, pointing right. */
const HOOKER = { format: 1, name: 'hooker', grid: ['C Gp>'], bindings: CONTROLS };
/** Two frames in a row, nobody's (debris). */
const TARGET = { format: 1, name: 'target', grid: ['F F'] };

const G = 'grapple@1,0';
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
/** The id of the robot's grapple. */
const gid = (robot: { parts: Map<string, unknown> }): string => [...robot.parts.keys()].find((k) => k.startsWith('grapple')) ?? 'none';
const posOf = (w: World, robot: { groups: { bodyId: number }[] }): { x: number; y: number } => w.physics.state(robot.groups[0]?.bodyId ?? 0);

describe('grapple (Batch)', () => {
  it('hooks the first thing in front of it within 60 m and reports hooked and length', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    w.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    for (let i = 0; i < 5; i++) w.step();
    expect(w.partOutput(me.id, G, 'hooked')).toBe(0);
    expect(w.partOutput(me.id, G, 'length')).toBe(0);
    w.step(press(me.id, 'f'));
    expect(w.partOutput(me.id, G, 'hooked')).toBe(1);
    // The barrel ends at x -98.5; the target's near face is at -80.51.
    expect(w.partOutput(me.id, G, 'length')).toBeCloseTo(18, 1);
    expect(w.events.filter((e) => e.kind === 'hooked')).toMatchObject([{ robot: me.id, part: G }]);
    expect(w.liveRopes().length).toBe(1);
    w.dispose();
  });

  it('reaches 60 m and no further; a hook in the ground anchors the rope', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const near = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    w.spawnBlueprint(TARGET, { x: -30, y: 0.5 });
    w.step(press(near.id, 'f'));
    expect(w.partOutput(near.id, G, 'hooked')).toBe(0);
    // Pointing down at the ground 19 m below: terrain is hooked, and the length is the drop.
    const up = w.spawnBlueprint({ ...HOOKER, grid: ['C', 'Gpv'] }, { x: 0, y: 20 });
    w.step(press(up.id, 'f'));
    expect(w.partOutput(up.id, gid(up), 'hooked')).toBe(1);
    expect(w.partOutput(up.id, gid(up), 'length')).toBeCloseTo(18, 0);
    w.dispose();
  });

  it('never hooks its own robot', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint({ ...HOOKER, grid: ['F F F', 'C Gp> F'] }, { x: -100, y: 0.5 });
    w.step(press(me.id, 'f'));
    expect(w.partOutput(me.id, G, 'hooked')).toBe(0);
    w.dispose();
  });

  it('fire is an edge: holding it does not hook again after a release', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    w.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    w.step(press(me.id, 'f'));
    for (let i = 0; i < 10; i++) w.step();
    w.step(press(me.id, 'x'));
    expect(w.partOutput(me.id, G, 'hooked')).toBe(0);
    w.step(lift(me.id, 'x'));
    for (let i = 0; i < 10; i++) w.step();
    expect(w.partOutput(me.id, G, 'hooked')).toBe(0);
    w.step(lift(me.id, 'f'));
    w.step(press(me.id, 'f'));
    expect(w.partOutput(me.id, G, 'hooked')).toBe(1);
    w.dispose();
  });

  it('reeled in, the rope drags a frame across the ground; unreeled it holds still', async () => {
    const still = await World.create({ seed: 1 }, flat);
    const a = still.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    const ta = still.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    still.step(press(a.id, 'f'));
    const d0 = dist(posOf(still, a), posOf(still, ta));
    for (let i = 0; i < 120; i++) still.step();
    expect(dist(posOf(still, a), posOf(still, ta))).toBeGreaterThan(d0 - 0.5);
    still.dispose();

    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    const target = w.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    w.step(press(me.id, 'f'));
    w.step(press(me.id, 'r'));
    for (let i = 0; i < 119; i++) w.step();
    // Two seconds: the winch runs at up to 5 m/s, and the two frames close at about 3 m/s (the rope pulls as fast as it can).
    expect(dist(posOf(w, me), posOf(w, target))).toBeLessThan(d0 - 4);
    expect(w.partOutput(me.id, G, 'length')).toBeLessThan(14);
    const at = posOf(w, target).x;
    expect(at).toBeLessThan(-80.5);
    // Paying out lengthens it again, up to the most it can be.
    const shortest = w.partOutput(me.id, G, 'length') ?? 0;
    w.step(lift(me.id, 'r'));
    w.step(press(me.id, 'e'));
    for (let i = 0; i < 59; i++) w.step();
    // A second at 5 m/s.
    expect(w.partOutput(me.id, G, 'length')).toBeCloseTo(shortest + 5, 0);
    w.dispose();
  });

  it('reels no shorter than 1 m', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    w.spawnBlueprint(TARGET, { x: -90, y: 0.5 });
    w.step(press(me.id, 'f'));
    w.step(press(me.id, 'r'));
    for (let i = 0; i < 600; i++) w.step();
    expect(w.partOutput(me.id, G, 'length')).toBeGreaterThanOrEqual(1);
    expect(w.partOutput(me.id, G, 'length')).toBeLessThan(2);
    w.dispose();
  });

  it('release drops the rope: nothing pulls after it', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    const target = w.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    w.step(press(me.id, 'f'));
    w.step(press(me.id, 'r'));
    for (let i = 0; i < 20; i++) w.step();
    w.step(press(me.id, 'x'));
    expect(w.partOutput(me.id, G, 'hooked')).toBe(0);
    expect(w.liveRopes().length).toBe(0);
    expect(w.events.filter((e) => e.kind === 'unhooked')).toMatchObject([{ part: G, why: 'released' }]);
    // Let both settle, then measure: still reeling (r is held) pulls nothing.
    for (let i = 0; i < 60; i++) w.step();
    const d = dist(posOf(w, me), posOf(w, target));
    for (let i = 0; i < 120; i++) w.step();
    expect(dist(posOf(w, me), posOf(w, target))).toBeGreaterThan(d - 0.5);
    w.dispose();
  });

  it('a destroyed grapple drops its rope, and so does a destroyed far part', async () => {
    const a = await World.create({ seed: 1 }, flat);
    const me = a.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    a.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    a.step(press(me.id, 'f'));
    for (let i = 0; i < 5; i++) a.step();
    const grapple = me.parts.get(G);
    if (!grapple) throw new Error('no grapple');
    grapple.health = 0;
    for (let i = 0; i < 3; i++) a.step();
    expect(a.liveRopes().length).toBe(0);
    expect(a.events.filter((e) => e.kind === 'unhooked')).toMatchObject([{ why: 'lost' }]);
    a.dispose();

    const b = await World.create({ seed: 1 }, flat);
    const me2 = b.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    const target = b.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
    b.step(press(me2.id, 'f'));
    for (let i = 0; i < 5; i++) b.step();
    expect(b.liveRopes().length).toBe(1);
    const hooked = target.parts.get('frame@0,0');
    if (!hooked) throw new Error('no frame');
    hooked.health = 0;
    for (let i = 0; i < 3; i++) b.step();
    expect(b.liveRopes().length).toBe(0);
    expect(b.partOutput(me2.id, G, 'hooked')).toBe(0);
    b.dispose();
  });

  it('a rope survives its robot being rebuilt: it ties to the new body and keeps pulling', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
    const target = w.spawnBlueprint({ format: 1, name: 'long', grid: ['F F F F'] }, { x: -80, y: 0.5 });
    w.step(press(me.id, 'f'));
    for (let i = 0; i < 5; i++) w.step();
    // Shoot off the far end: the target is rebuilt (a new body), and the part the hook is in stays.
    const far = target.parts.get('frame@3,0');
    if (!far) throw new Error('no frame');
    const bodyBefore = target.groups[0]?.bodyId;
    far.health = 0;
    w.step();
    expect(target.groups[0]?.bodyId).not.toBe(bodyBefore);
    expect(w.liveRopes().length).toBe(1);
    const d0 = dist(posOf(w, me), posOf(w, target));
    w.step(press(me.id, 'r'));
    for (let i = 0; i < 119; i++) w.step();
    expect(dist(posOf(w, me), posOf(w, target))).toBeLessThan(d0 - 4);
    expect(w.partOutput(me.id, G, 'hooked')).toBe(1);
    w.dispose();
  });

  it('a hook in a fixed block lets a robot swing: it falls in an arc, never farther than the rope', async () => {
    const world = parseWorldFile({ name: 'anchor', ground: { width: 1000, thickness: 2 }, spawn: { x: 0, y: 6 }, boxes: [{ x: 30, y: 60, w: 2, h: 2 }] });
    const swing = async (hook: boolean): Promise<number> => {
      const w = await World.create({ seed: 1 }, world);
      const me = w.spawnBlueprint(HOOKER, { x: 0, y: 60 });
      if (hook) w.step(press(me.id, 'f'));
      let furthest = 0;
      for (let i = 0; i < 180; i++) {
        w.step();
        const s = posOf(w, me);
        furthest = Math.max(furthest, dist(s, { x: 30, y: 60 }));
      }
      if (hook) expect(w.partOutput(me.id, G, 'hooked')).toBe(1);
      w.dispose();
      return furthest;
    };
    // The block's near face is 29 m from the barrel; hanging from it, the core stays within about 30 m of its center.
    expect(await swing(true)).toBeLessThan(31.5);
    expect(await swing(false)).toBeGreaterThan(45);
  });

  it('deterministic: the same run gives the same hash, and a rope shows in it', async () => {
    const run = async (rope: boolean): Promise<string[]> => {
      const w = await World.create({ seed: 5 }, flat);
      const me = w.spawnBlueprint(HOOKER, { x: -100, y: 0.5 });
      w.spawnBlueprint(TARGET, { x: -80, y: 0.5 });
      const hashes: string[] = [];
      for (let i = 0; i < 90; i++) {
        w.step(i === 0 && rope ? press(me.id, 'f') : i === 10 && rope ? press(me.id, 'r') : []);
        hashes.push(w.hash());
      }
      w.dispose();
      return hashes;
    };
    const a = await run(true);
    expect(await run(true)).toEqual(a);
    expect((await run(false))[89]).not.toBe(a[89]);
  });

  it('a world without grapples hashes as before (no grapple block)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint({ format: 1, name: 'plain', grid: ['C F'] }, { x: 0, y: 0.5 });
    const before = w.hash();
    const w2 = await World.create({ seed: 1 }, flat);
    w2.spawnBlueprint({ format: 1, name: 'plain', grid: ['C F'] }, { x: 0, y: 0.5 });
    expect(w2.hash()).toBe(before);
    w.dispose();
    w2.dispose();
  });

  it('the def: shipped, and a grapple needs its inputs and outputs', () => {
    const def = defaultRegistry().get('grapple');
    expect(def.grapple).toEqual({ reach: 60, reelSpeed: 5, minLength: 1, maxLength: 60 });
    expect(defaultRegistry().ids().at(-1)).toBe('grapple');
    const without = (drop: string): unknown => ({ ...grappleJson, inputs: grappleJson.inputs.filter((c) => c.name !== drop) });
    expect(() => parsePartDef(without('release'), 'g.json')).toThrow(PartDefError);
    expect(() => parsePartDef(without('release'), 'g.json')).toThrow(/"release" input/);
    expect(() => parsePartDef({ ...grappleJson, outputs: [] }, 'g.json')).toThrow(/"hooked" output/);
    expect(() => parsePartDef({ ...grappleJson, grapple: { ...grappleJson.grapple, maxLength: 0.5 } }, 'g.json')).toThrow(/at least minLength/);
  });
});
