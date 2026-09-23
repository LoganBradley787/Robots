import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

/** Long two-wheeled robot with the core at one end: Logan's bomb-test robot. The battery powers the far half. */
const LONGCAR = { format: 1, name: 'longcar', grid: ['C  F  F  F  B  F', 'W  .  .  .  .  W'] };

function destroy(robot: Robot, partId: string): void {
  const p = robot.parts.get(partId);
  if (!p) throw new Error(`no part ${partId}`);
  p.health = 0;
}

/** Mass-weighted velocity and center of mass over a robot's bodies. */
function motionOf(w: World, robots: Robot[]): { m: number; px: number; py: number; cx: number; cy: number } {
  let m = 0;
  let px = 0;
  let py = 0;
  let cx = 0;
  let cy = 0;
  for (const r of robots) {
    for (const g of r.groups) {
      const mp = w.physics.massProperties(g.bodyId);
      const s = w.physics.state(g.bodyId);
      m += mp.mass;
      px += mp.mass * s.vx;
      py += mp.mass * s.vy;
      cx += mp.mass * mp.comX;
      cy += mp.mass * mp.comY;
    }
  }
  return { m, px, py, cx: cx / m, cy: cy / m };
}

describe('destruction: splitting (M6)', () => {
  it('a moving, spinning robot cut in the middle: pieces keep the velocity field and momentum', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint({ format: 1, name: 'bar', grid: ['C  F  F  F  F  F'] }, { x: 0, y: 20 });
    const body = r.groups[0]?.bodyId as number;
    w.physics.kick(body, 3, 1, 0.8);
    w.step();
    w.step();
    const before = motionOf(w, [r]);
    const v0 = { x: before.px / before.m, y: before.py / before.m };
    const w0 = w.physics.state(body).w;
    destroy(r, 'frame@2,0');
    w.step();
    const pieces = w.robots;
    expect(pieces.map((p) => [...p.parts.keys()])).toEqual([
      ['core@0,0', 'frame@1,0'],
      ['frame@3,0', 'frame@4,0', 'frame@5,0'],
    ]);
    // Where each piece's center of mass was at the split (after it, the pieces fly apart in straight lines), and
    // where the whole robot's was: it moved one step at v0 since `before`.
    const coms = pieces.map((p) => w.physics.massProperties(p.groups[0]?.bodyId as number));
    const P = { x: before.cx + v0.x / 60, y: before.cy + v0.y / 60 };
    w.step();
    w.step();
    pieces.forEach((p, i) => {
      const s = w.physics.state(p.groups[0]?.bodyId as number);
      const c = coms[i] as { comX: number; comY: number };
      expect(Math.abs(s.w - w0) / w0).toBeLessThan(0.02);
      // The rigid motion's velocity at the piece's center: v + w x (c - P). Momentum follows from it.
      expect(s.vx).toBeCloseTo(v0.x - w0 * (c.comY - P.y), 2);
      expect(s.vy).toBeCloseTo(v0.y + w0 * (c.comX - P.x), 2);
    });
    w.dispose();
  });

  it("Logan's cut: the core-less half keeps its wheel speed latched and rolls on", async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(LONGCAR, { x: -100, y: 1.5 });
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 120; i++) w.step();
    destroy(car, 'frame@2,1');
    w.step();
    const half = w.robots.find((r) => r.id !== car.id) as Robot;
    expect(half.brokeFrom).toBe(car.id);
    expect(w.canControl(half.id)).toBe(false);
    expect(w.channelValue(half.id, 'wheel@5,0', 'speed')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'split')).toEqual([{ tick: 121, robot: car.id, kind: 'split', pieces: [half.id] }]);
    // Stop the core's half; the other half keeps driving.
    w.step([{ robot: car.id, pressed: [], released: ['d'] }]);
    for (let i = 0; i < 120; i++) w.step();
    const s = w.physics.state(half.groups[0]?.bodyId as number);
    expect(s.vx).toBeGreaterThan(2);
    expect(w.channelValue(car.id, 'wheel@0,0', 'speed')).toBe(0);
    w.dispose();
  });

  it('a destroyed core stops control and scripts; the robot keeps its last input', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(LONGCAR, { x: -100, y: 1.5 });
    w.step([{ robot: car.id, pressed: ['d'], released: [] }]);
    destroy(car, 'core@0,1');
    w.step();
    expect(w.canControl(car.id)).toBe(false);
    expect(w.events.some((e) => e.kind === 'coreLost' && e.robot === car.id)).toBe(true);
    // The front wheel hung under the core, so it fell off as a piece of its own.
    expect(w.robots.map((r) => [...r.parts.keys()])).toEqual([
      ['frame@1,1', 'frame@2,1', 'frame@3,1', 'battery@4,1', 'frame@5,1', 'wheel@5,0'],
      ['wheel@0,0'],
    ]);
    expect(w.channelValue(car.id, 'wheel@5,0', 'speed')).toBe(1);
    // An input sent before the caller noticed is dropped, not an error.
    w.step([{ robot: car.id, pressed: [], released: ['d'] }]);
    expect(w.channelValue(car.id, 'wheel@5,0', 'speed')).toBe(1);
    w.dispose();
  });

  it('a piece that breaks off with one core wakes it, with auto controls for its own parts', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint({ format: 1, name: 'twin', grid: ['C  F  F  C', 'W  .  .  W'] }, { x: 0, y: 1.5 });
    destroy(r, 'frame@1,1');
    w.step();
    const other = w.robots.find((x) => x.id !== r.id) as Robot;
    expect(other.woke).toBe(true);
    expect(other.primaryCoreId).toBe('core@3,1');
    expect(w.canControl(other.id)).toBe(true);
    expect(w.controller(other.id)?.keys).toEqual(['d', 'a']);
    expect(w.events.some((e) => e.kind === 'coreWoke' && e.robot === other.id && e.from === r.id)).toBe(true);
    // The original keeps its own controls.
    expect(w.canControl(r.id)).toBe(true);
    w.dispose();
  });

  it('the pilot dying does not wake a core still attached to the body (Q1)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint({ format: 1, name: 'jet', grid: ['C  F  F  C  F  F'] }, { x: 0, y: 1.5 });
    destroy(r, 'core@0,0');
    w.step();
    expect(w.robots).toHaveLength(1);
    expect(w.canControl(r.id)).toBe(false);
    w.dispose();
  });

  it('a robot with every part destroyed is removed', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint({ format: 1, name: 'box', grid: ['F'] }, { x: 0, y: 3 });
    destroy(r, 'frame@0,0');
    w.step();
    expect(w.robots).toEqual([]);
    expect(w.events.some((e) => e.kind === 'removed' && e.robot === r.id)).toBe(true);
    w.dispose();
  });

  it('a rebuilt robot mid-tumble keeps its angle and its wheels', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const car = w.spawnBlueprint(LONGCAR, { x: 0, y: 20 });
    w.physics.kick(car.groups[0]?.bodyId as number, 0, 0, 1.5);
    for (let i = 0; i < 60; i++) w.step();
    const before = w.physics.state(car.groups[0]?.bodyId as number);
    expect(Math.abs(before.angle)).toBeGreaterThan(0.5);
    destroy(car, 'frame@3,1');
    w.step();
    const after = w.physics.state(car.groups[0]?.bodyId as number);
    expect(Math.abs(after.angle - before.angle - before.w / 60)).toBeLessThan(0.01);
    w.step();
    w.step();
    expect(w.physics.state(car.groups[0]?.bodyId as number).w).toBeCloseTo(before.w, 1);
    w.dispose();
  });
});

describe('decoupler (M6)', () => {
  const STACK = {
    format: 1,
    name: 'stack',
    grid: ['F', 'D', 'C'],
    bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }],
  };

  it('fires once: the part above leaves, both sides push apart', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const r = w.spawnBlueprint(STACK, { x: 0, y: 20 });
    expect(w.partOutput(r.id, 'decoupler@0,1', 'armed')).toBe(1);
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    expect(w.robots.map((x) => [...x.parts.keys()])).toEqual([['decoupler@0,1', 'core@0,0'], ['frame@0,2']]);
    expect(w.partOutput(r.id, 'decoupler@0,1', 'armed')).toBe(0);
    w.step();
    w.step();
    const top = w.robots[1] as Robot;
    // 2 N s each way: the 1 kg frame goes up at 2 m/s, the 3 kg rest goes down at 2/3 m/s.
    expect(w.physics.state(top.groups[0]?.bodyId as number).vy).toBeCloseTo(2, 1);
    expect(w.physics.state(r.groups[0]?.bodyId as number).vy).toBeCloseTo(-2 / 3, 1);
    // Firing again does nothing: the face is already cut.
    w.step([{ robot: r.id, pressed: [], released: ['f'] }]);
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    expect(w.robots).toHaveLength(2);
    w.dispose();
  });

  it('a replay with a decoupled split matches', async () => {
    const w = await World.create({ seed: 3 }, flat);
    const r = w.spawnBlueprint(STACK, { x: 0, y: 1.5 });
    for (let i = 0; i < 90; i++) w.step(i === 20 ? [{ robot: r.id, pressed: ['f'], released: [] }] : []);
    const replay = buildReplay(w);
    const again = await runReplay(replay);
    expect(again.matches).toBe(true);
    expect(again.world.robots).toHaveLength(2);
    again.world.dispose();
    w.dispose();
  });
});

describe('clear debris (M6)', () => {
  it('removes robots nobody can control, logged so replays match', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const stack = w.spawnBlueprint(
      { format: 1, name: 'stack', grid: ['F', 'D', 'C'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] },
      { x: 0, y: 1.5 },
    );
    w.spawnBlueprint({ format: 1, name: 'box', grid: ['F'] }, { x: 10, y: 3 });
    w.step([{ robot: stack.id, pressed: ['f'], released: [] }]);
    expect(w.robots).toHaveLength(3);
    w.clearDebris();
    w.step();
    expect(w.robots.map((r) => r.id)).toEqual([stack.id]);
    const again = await runReplay(buildReplay(w));
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });
});
