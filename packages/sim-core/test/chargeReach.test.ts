import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { rotateCell } from '../src/parts/faces';

/**
 * The charge check skips a robot whose parts cannot count (a friend's, or nobody's) or whose bodies are all out of
 * reach, before it looks at a single part. These tests hold it to the plain rule, part by part: an armed charge goes
 * off exactly when a cell of a robot of another team that somebody controls (or of a burning flare standing in for
 * one) is within its radius.
 */

/** No gravity and a far-away ground: nothing moves unless kicked. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 300 } });
const CHARGE = { format: 1, name: 'charge', grid: ['Xd'], legend: { Xd: { part: 'charge', armed: true } } };
const RADIUS = 1.5;

/** The world center of every cell of every part of a robot. */
function cellsOf(w: World, r: Robot): { x: number; y: number; partId: string }[] {
  const out: { x: number; y: number; partId: string }[] = [];
  for (const p of r.parts.values()) {
    if (!r.groups[p.group]) continue;
    const pose = partWorldPose(w, r, p.id);
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    for (const fc of p.footprint ?? p.def.footprint) {
      const o = rotateCell(fc, p.rot);
      out.push({ x: pose.x + c * o.x - s * o.y, y: pose.y + s * o.x + c * o.y, partId: p.id });
    }
  }
  return out;
}

/** The plain rule: whether any cell that counts for a charge of `team` at `at` is within the radius. */
function shouldGoOff(w: World, self: Robot, at: { x: number; y: number }): boolean {
  for (const other of w.robots) {
    if (other === self) continue;
    for (const cell of cellsOf(w, other)) {
      const p = other.parts.get(cell.partId);
      if (!p) continue;
      const standsFor = (p.burn ?? 0) > 0 && p.decoyOf !== undefined && p.decoyOf !== other.id ? w.robots.find((r) => r.id === p.decoyOf) : undefined;
      const seen = standsFor ?? other;
      // Somebody controls it: it has a live core (true of every robot in these scenes that has one).
      if (seen === self || seen.team === self.team || seen.primaryCoreId === undefined) continue;
      if ((cell.x - at.x) ** 2 + (cell.y - at.y) ** 2 <= RADIUS * RADIUS) return true;
    }
  }
  return false;
}

/**
 * Spots around `subject` whose nearest cell of it is just inside the radius (every other column) or just outside it
 * (the columns between), clear of every cell in the world and of each other.
 */
function spotsAround(w: World, subject: Robot, taken: { x: number; y: number }[]): { x: number; y: number }[] {
  const mine = cellsOf(w, subject);
  const all = w.robots.flatMap((r) => cellsOf(w, r));
  const xs = mine.map((c) => c.x);
  const ys = mine.map((c) => c.y);
  const found: { x: number; y: number }[] = [];
  const nearest = (cells: { x: number; y: number }[], x: number, y: number): number => Math.sqrt(Math.min(...cells.map((c) => (c.x - x) ** 2 + (c.y - y) ** 2)));
  // Columns far enough apart for a charge each, so the spots end up on every side.
  let column = 0;
  for (let x = Math.min(...xs) - 3; x <= Math.max(...xs) + 3; x += 1.45, column++) {
    const [lo, hi] = column % 2 === 0 ? [1.42, 1.47] : [1.53, 1.62];
    for (let y = Math.min(...ys) - 3; y <= Math.max(...ys) + 3; y += 0.013) {
      const d = nearest(mine, x, y);
      if (d <= lo || d >= hi) continue;
      // Two cells this far apart never overlap, whatever their angles.
      if (nearest(all, x, y) < 1.42 || (taken.length > 0 && nearest(taken, x, y) < 1.42)) continue;
      found.push({ x, y });
      taken.push({ x, y });
    }
  }
  return found;
}

describe('the charge check, robot by robot', () => {
  it('goes off exactly when the plain rule says: around two turned robots (one of two bodies), a bay, a friend, a wreck, and flares', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const light = [
      { key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 },
      { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
    ];
    // An enemy of two bodies: a slab, and a gun on a rotator at its end.
    const big = w.spawnBlueprint(
      { format: 1, name: 'big', grid: ['F F F F F F F . .', 'F F C B F F F r g', 'F F F F F F F . .'], legend: { r: { part: 'rotator', rot: 270 }, g: { part: 'gun', rot: 270 } } },
      { x: 0, y: 300 },
      { team: 1 },
    );
    // An enemy that is tall where the first is wide, turning the other way.
    const tall = w.spawnBlueprint({ format: 1, name: 'tall', grid: ['F F', 'F F', 'F F', 'F F', 'C B', 'F F', 'F F', 'F F', 'F F', 'F F'] }, { x: 120, y: 300 }, { team: 1 });
    // An enemy with a part of many cells (a bay is a cup of 13).
    const bay = w.spawnBlueprint(
      { format: 1, name: 'bay', parts: [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: -1, y: 0 }, { part: 'densebattery', x: 1, y: 0 }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }], recipes: { item: { format: 1, name: 'item', grid: ['C', 'F'] } } },
      { x: 60, y: 300 },
      { team: 1 },
    );
    const friend = w.spawnBlueprint({ format: 1, name: 'friend', grid: ['F C B F'] }, { x: -60, y: 300 }, { team: 0 });
    // The other team's, but nobody controls it: no core.
    const wreck = w.spawnBlueprint({ format: 1, name: 'wreck', grid: ['F F F', 'F F F'] }, { x: 0, y: 360 }, { team: 1 });
    const enemyFlarer = w.spawnBlueprint({ format: 1, name: 'flarer', grid: ['C  D>  Q>'], bindings: light }, { x: 0, y: 240 }, { team: 1 });
    const friendFlarer = w.spawnBlueprint({ format: 1, name: 'flarer', grid: ['C  D>  Q>'], bindings: light }, { x: -60, y: 240 }, { team: 0 });
    w.kickRobot(big, 0, 0, 0.9);
    w.kickRobot(tall, 0, 0, -1.3);
    for (let i = 0; i < 20; i++) w.step();
    w.step([enemyFlarer, friendFlarer].map((r) => ({ robot: r.id, pressed: ['v'], released: [] })));
    for (let i = 0; i < 25; i++) w.step();
    // Stop everything where it is.
    for (const r of w.robots) w.kickRobot(r, 0, 0, 0);
    for (let i = 0; i < 4; i++) w.step();
    const before = w.robots.map((r) => cellsOf(w, r));
    w.step();
    const moved = Math.max(...w.robots.flatMap((r, i) => cellsOf(w, r).map((c, j) => Math.hypot(c.x - (before[i]?.[j]?.x ?? 0), c.y - (before[i]?.[j]?.y ?? 0)))));
    expect(moved).toBeLessThan(1e-3);
    const enemyFlare = w.robots.find((r) => r.brokeFrom === enemyFlarer.id);
    const friendFlare = w.robots.find((r) => r.brokeFrom === friendFlarer.id);
    if (!enemyFlare || !friendFlare) throw new Error('a flare did not come off');
    expect([...enemyFlare.parts.values()][0]?.burn ?? 0).toBeGreaterThan(10);
    expect(big.groups).toHaveLength(2);
    // The slab turned well off the grid, so its box check works in its own frame.
    expect(Math.abs(Math.sin(2 * partWorldPose(w, big, 'core@2,1').angle))).toBeGreaterThan(0.3);

    // Charges just inside and just outside the radius of each of them, on every side.
    const taken: { x: number; y: number }[] = [];
    const charges: { robot: Robot; at: { x: number; y: number } }[] = [];
    for (const subject of [big, tall, bay, friend, wreck, enemyFlare, friendFlare, enemyFlarer]) {
      for (const at of spotsAround(w, subject, taken)) charges.push({ robot: w.spawnBlueprint(CHARGE, at, { team: 0 }), at });
    }
    expect(charges.length).toBeGreaterThan(50);
    const expected = charges.filter((c) => shouldGoOff(w, c.robot, c.at)).map((c) => c.robot.id);
    const quiet = charges.length - expected.length;
    // Both answers are well represented: near the enemy's bodies, its bay, and its flare it goes off; elsewhere not.
    expect(expected.length).toBeGreaterThan(12);
    expect(quiet).toBeGreaterThan(25);
    const tick = w.tick;
    w.step();
    const wentOff = w.events.flatMap((e) => (e.tick === tick && e.kind === 'partDestroyed' && e.partType === 'charge' && e.exploded ? [e.robot] : []));
    expect([...wentOff].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    w.dispose();
  });

  it('a charge far from a big robot is not set off, and one that drifts into it is, on the tick it comes within the radius', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const rows = Array.from({ length: 20 }, (_, y) => Array.from({ length: 30 }, (_, x) => (x === 0 && y === 0 ? 'C' : 'F')).join(' '));
    const big = w.spawnBlueprint({ format: 1, name: 'slab', grid: rows }, { x: 0, y: 300 }, { team: 1 });
    const far = w.spawnBlueprint(CHARGE, { x: -200, y: 300 }, { team: 0 });
    const closing = w.spawnBlueprint(CHARGE, { x: -8, y: 295 }, { team: 0 });
    w.kickRobot(closing, 6, 0);
    let wentOffAt: number | undefined;
    for (let i = 0; i < 120 && wentOffAt === undefined; i++) {
      const at = partWorldPose(w, closing, 'charge@0,0');
      const cells = cellsOf(w, big);
      w.step();
      if (w.events.some((e) => e.kind === 'partDestroyed' && e.robot === closing.id && e.exploded)) {
        wentOffAt = w.tick;
        // The tick before it was still out of reach of every cell; one step on (6 m/s) it was not.
        const nearest = Math.sqrt(Math.min(...cells.map((c) => (c.x - at.x) ** 2 + (c.y - at.y) ** 2)));
        expect(nearest).toBeGreaterThan(RADIUS);
        expect(nearest).toBeLessThan(RADIUS + 0.2);
      }
    }
    expect(wentOffAt).toBeDefined();
    expect(far.parts.size).toBe(1);
    w.dispose();
  });
});
