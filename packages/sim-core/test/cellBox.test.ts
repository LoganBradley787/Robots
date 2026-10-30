import { beforeAll, describe, expect, it } from 'vitest';
import { mergeCells, type MergeCell } from '../src/assembly/merge';
import { CELL_HALF } from '../src/assembly/build';
import { cellAt, walkCells, type CellBox } from '../src/physics/cellBox';
import { PhysicsWorld, pressureShares, type ContactImpulse } from '../src/physics/PhysicsWorld';
import { loadRapier } from '../src/physics/rapier';
import { Prng } from '../src/rng/Prng';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';

beforeAll(async () => {
  await loadRapier();
});

const box = (x: number, y: number, w: number, h: number): CellBox => {
  const owners: string[] = [];
  for (let cx = 0; cx < w; cx++) for (let cy = 0; cy < h; cy++) owners.push(`${x + cx},${y + cy}`);
  return { body: 1, half: CELL_HALF, x, y, w, h, owners };
};
const walk = (b: CellBox, ox: number, oy: number, dx: number, dy: number, length = 100): [string, number][] => {
  const out: [string, number][] = [];
  walkCells(b, ox, oy, dx, dy, length, (owner, d) => {
    out.push([owner, d]);
    return false;
  });
  return out;
};

describe('walking a ray through a box of cells', () => {
  it('meets each cell of a row where the cell starts, with the gaps between', () => {
    const hits = walk(box(0, 0, 3, 1), -2, 0, 1, 0);
    expect(hits.map((h) => h[0])).toEqual(['0,0', '1,0', '2,0']);
    expect(hits[0]?.[1]).toBeCloseTo(1.51, 9);
    expect(hits[1]?.[1]).toBeCloseTo(2.51, 9);
    expect(hits[2]?.[1]).toBeCloseTo(3.51, 9);
  });

  it('comes the other way, and up and down a column', () => {
    expect(walk(box(0, 0, 3, 1), 9, 0, -1, 0).map((h) => h[0])).toEqual(['2,0', '1,0', '0,0']);
    expect(walk(box(0, 0, 1, 3), 0, 9, 0, -1).map((h) => h[0])).toEqual(['0,2', '0,1', '0,0']);
    expect(walk(box(-2, -2, 1, 3), -2, -5, 0, 1).map((h) => h[0])).toEqual(['-2,-2', '-2,-1', '-2,0']);
  });

  it('starting in a gap meets the next cell where it starts; starting inside a cell meets it at 0', () => {
    const gap = walk(box(0, 0, 3, 1), 0.5, 0, 1, 0);
    expect(gap[0]?.[0]).toBe('1,0');
    expect(gap[0]?.[1]).toBeCloseTo(0.01, 9);
    expect(walk(box(0, 0, 3, 1), 1.2, 0, 1, 0)[0]).toEqual(['1,0', 0]);
  });

  it('a diagonal goes corner to corner through the cells on it', () => {
    const owners = walk(box(0, 0, 3, 3), -2, -2, Math.SQRT1_2, Math.SQRT1_2).map((h) => h[0]);
    expect(owners[0]).toBe('0,0');
    expect(owners[owners.length - 1]).toBe('2,2');
    expect(owners).toContain('1,1');
  });

  it('stops at its length, and when `visit` has what it wants', () => {
    expect(walk(box(0, 0, 3, 1), -2, 0, 1, 0, 3)).toHaveLength(2);
    expect(walk(box(0, 0, 3, 1), -2, 0, 1, 0, 1)).toHaveLength(0);
    const seen: string[] = [];
    walkCells(box(0, 0, 3, 1), -2, 0, 1, 0, 100, (owner) => {
      seen.push(owner);
      return true;
    });
    expect(seen).toEqual(['0,0']);
  });

  it('a ray that misses the box meets nothing', () => {
    expect(walk(box(0, 0, 3, 3), -2, 5, 1, 0)).toEqual([]);
    expect(walk(box(0, 0, 3, 3), 5, 5, 1, 0)).toEqual([]);
    expect(walk(box(0, 0, 3, 3), 1.5, 5, 0, 1)).toEqual([]);
  });

  it('a point on a face is the cell under it, one a hair outside too', () => {
    const b = box(2, 1, 4, 3);
    expect(cellAt(b, 3.2, 0.51)).toBe('3,1');
    expect(cellAt(b, 5.49, 3.2)).toBe('5,3');
    expect(cellAt(b, 5.6, 3.6)).toBe('5,3');
    expect(cellAt(b, 1, 0)).toBe('2,1');
  });
});

/** A body of these cells built twice in one world, far apart: merged, and one collider a cell. */
const twins = (pw: PhysicsWorld, cells: MergeCell[], angle: number): { merged: number; plain: number; gap: number } => {
  const gap = 200;
  const merged = pw.createBody({ x: 3, y: 5, angle, kind: 'dynamic' });
  const plain = pw.createBody({ x: 3 + gap, y: 5, angle, kind: 'dynamic' });
  for (const rect of mergeCells(cells, CELL_HALF)) {
    if (rect.owners.length > 1) pw.addCellBox(merged, rect, CELL_HALF, 0.3);
    else pw.addCollider(merged, { shape: 'box', hx: CELL_HALF, hy: CELL_HALF }, { offsetX: rect.x, offsetY: rect.y, mass: rect.mass, friction: 0.3 }, rect.owners[0]);
  }
  for (const c of cells) pw.addCollider(plain, { shape: 'box', hx: CELL_HALF, hy: CELL_HALF }, { offsetX: c.x, offsetY: c.y, mass: c.mass, friction: 0.3 }, c.owner);
  return { merged, plain, gap };
};

/** A lumpy body with holes, of parts up to three cells long, heavy and light. */
const lump = (): MergeCell[] => {
  const cells: MergeCell[] = [];
  for (let x = -7; x <= 7; x++) {
    for (let y = -4; y <= 4; y++) {
      if ((x === 2 && y === 1) || (x === -3 && y >= 0) || (x + y > 8)) continue;
      cells.push({ x, y, owner: `p${Math.floor((x + 7) / 3)}.${y}`, mass: 1 + ((x * x + y) % 5) * 3 });
    }
  }
  return cells;
};

describe('a box of cells against the same cells as separate colliders', () => {
  it('has the same mass, center of mass and inertia', () => {
    const pw = new PhysicsWorld(0, 1 / 60);
    const { merged, plain, gap } = twins(pw, lump(), 0.7);
    const m = pw.massProperties(merged);
    const p = pw.massProperties(plain);
    expect(Math.abs(m.mass / p.mass - 1)).toBeLessThan(1e-6);
    expect(Math.abs(m.comX + gap - p.comX)).toBeLessThan(1e-4);
    expect(Math.abs(m.comY - p.comY)).toBeLessThan(1e-4);
    expect(Math.abs(m.inertia / p.inertia - 1)).toBeLessThan(1e-5);
    pw.free();
  });

  it('a ray meets the same parts in the same order, from anywhere, at any angle', () => {
    for (const angle of [0, 0.7, -2.2]) {
      const pw = new PhysicsWorld(0, 1 / 60);
      const { gap } = twins(pw, lump(), angle);
      pw.step();
      const rng = new Prng(7);
      let walked = 0;
      for (let i = 0; i < 400; i++) {
        const a = rng.next() * 2 * Math.PI;
        const r = rng.next() * 12;
        const b = rng.next() * 2 * Math.PI;
        const x = 3 + r * Math.cos(a);
        const y = 5 + r * Math.sin(a);
        const dx = Math.cos(b);
        const dy = Math.sin(b);
        const hits = pw.rayHits(x, y, dx, dy, 40);
        const same = pw.rayHits(x + gap, y, dx, dy, 40);
        const near = hits.map((h) => h.owner);
        const twin = same.map((h) => h.owner);
        // A ray can slip through a 2 cm gap between two cells of the plain body and graze a corner of the next: the
        // two lists may differ at grazed corners, never in what the ray first meets, and rarely at all.
        expect(near[0]).toBe(twin[0]);
        if (hits[0] && same[0]) expect(Math.abs(hits[0].distance - same[0].distance)).toBeLessThan(1e-3);
        walked += near.length;
        expect(Math.abs(near.length - twin.length)).toBeLessThanOrEqual(2);
      }
      expect(walked).toBeGreaterThan(400);
      pw.free();
    }
  });

  it('castRay answers like the cell-by-cell body, skipping a part or a whole body', () => {
    const pw = new PhysicsWorld(0, 1 / 60);
    const { merged, plain, gap } = twins(pw, lump(), 0.4);
    pw.step();
    const rng = new Prng(11);
    for (let i = 0; i < 300; i++) {
      const a = rng.next() * 2 * Math.PI;
      const x = 3 + 30 * Math.cos(a);
      const y = 5 + 30 * Math.sin(a);
      const aim = a + Math.PI + (rng.next() - 0.5);
      const dx = Math.cos(aim);
      const dy = Math.sin(aim);
      const bare = pw.castRay(x, y, dx, dy, 60);
      const twin = pw.castRay(x + gap, y, dx, dy, 60);
      expect(bare?.owner).toBe(twin?.owner);
      if (!bare || !twin) continue;
      expect(Math.abs(bare.distance - twin.distance)).toBeLessThan(1e-3);
      // Skip the part it hit: the ray goes on to what is behind it, deep inside the box.
      const part = bare.owner;
      const on = pw.castRay(x, y, dx, dy, 60, (_b, owner) => owner === part, part);
      const onTwin = pw.castRay(x + gap, y, dx, dy, 60, (_b, owner) => owner === part, part);
      expect(on?.owner).toBe(onTwin?.owner);
      if (on && onTwin) expect(Math.abs(on.distance - onTwin.distance)).toBeLessThan(1e-3);
      // A skip that takes the whole body: nothing of it is met.
      expect(pw.castRay(x, y, dx, dy, 60, (b) => b === merged)?.body).not.toBe(merged);
    }
    expect(plain).not.toBe(merged);
    pw.free();
  });

  it('a ray stopped by something in a hollow of a skipped part is not sent past it', () => {
    const pw = new PhysicsWorld(0, 1 / 60);
    const cells: MergeCell[] = [];
    for (let x = 0; x < 6; x++) cells.push({ x, y: 0, owner: x < 3 ? 'skip' : 'rest', mass: 1 });
    const b = pw.createBody({ x: 0, y: 0, kind: 'dynamic' });
    pw.addCellBox(b, mergeCells(cells, CELL_HALF)[0] as never, CELL_HALF, 0.3);
    const other = pw.createBody({ x: 1, y: 0.2, kind: 'fixed' });
    pw.addCollider(other, { shape: 'box', hx: 0.1, hy: 0.1 }, { offsetX: 0, offsetY: 0, mass: 0 });
    pw.step();
    // Everything of the first three cells is skipped, and a thing sits inside them: it comes first.
    const hit = pw.castRay(-3, 0.2, 1, 0, 20, (_b, owner) => owner === 'skip');
    expect(hit?.body).toBe(other);
    expect(hit?.distance).toBeCloseTo(3.9, 3);
    pw.free();
  });

  it('counts its cells for air drag, as separate colliders do', () => {
    const pw = new PhysicsWorld(0, 1 / 60);
    const { merged, plain } = twins(pw, lump(), 0);
    pw.step();
    pw.setVelocity(merged, 30, 0, 0);
    pw.setVelocity(plain, 30, 0, 0);
    for (let i = 0; i < 30; i++) pw.step();
    expect(pw.state(merged).vx).toBeLessThan(30);
    expect(Math.abs(pw.state(merged).vx - pw.state(plain).vx)).toBeLessThan(1e-3);
    pw.free();
  });

  it('forgets its cells with its body', () => {
    const pw = new PhysicsWorld(0, 1 / 60);
    const { merged, plain } = twins(pw, lump(), 0);
    pw.removeBody(merged);
    pw.removeBody(plain);
    expect(pw.colliderOwners()).toEqual([]);
    pw.free();
  });
});

describe('contacts of a box of cells', () => {
  /** A flat slab of parts `s0` to `s<w-1>` falling onto something, stepped until the first hard contact. */
  const slabOn = (angle: number, ground: (pw: PhysicsWorld) => void, cols = 10): { pw: PhysicsWorld; body: number; contacts: ContactImpulse[] } => {
    const pw = new PhysicsWorld(-9.81, 1 / 60);
    ground(pw);
    const cells: MergeCell[] = [];
    for (let x = 0; x < cols; x++) for (let y = 0; y < 2; y++) cells.push({ x, y, owner: `s${x}.${y}`, mass: 1 });
    const body = pw.createBody({ x: -(cols - 1) / 2, y: 3, angle, kind: 'dynamic' });
    pw.addCellBox(body, mergeCells(cells, CELL_HALF)[0] as never, CELL_HALF, 0.3);
    pw.step();
    pw.setVelocity(body, 0, -30, 0);
    for (let i = 0; i < 30; i++) {
      pw.step();
      const contacts = pw.contactImpulses([body]);
      if (contacts.some((c) => Math.abs(c.jy) > 1)) return { pw, body, contacts };
    }
    throw new Error('never landed');
  };
  const flatGround = (pw: PhysicsWorld): void => void pw.createFixedBox(0, -1, 100, 2);

  it('a flat landing touches every cell of the face, none above it, evenly', () => {
    const { pw, body, contacts } = slabOn(0, flatGround);
    const owners = new Set(contacts.map((c) => (c.body1 === body ? c.owner1 : c.owner2)));
    expect(owners).toEqual(new Set(Array.from({ length: 10 }, (_, x) => `s${x}.0`)));
    const pushes = contacts.map((c) => Math.abs(c.jy));
    expect(Math.max(...pushes) / Math.min(...pushes)).toBeLessThan(1.5);
    pw.free();
  });

  it('adds up to the manifold it came from: the whole impulse, each side once', () => {
    const { pw, body, contacts } = slabOn(0, flatGround);
    const total = contacts.reduce((s, c) => s + (c.body1 === body ? -c.jy : c.jy), 0);
    const momentum = pw.massProperties(body).mass * (pw.state(body).vy - pw.prevState(body).vy + 9.81 / 60);
    expect(Math.abs(total / momentum - 1)).toBeLessThan(0.02);
    pw.free();
  });

  it('a tilted landing lands at its low corner, not along the whole face', () => {
    const { pw, body, contacts } = slabOn(0.2, flatGround);
    const owners = new Set(contacts.filter((c) => Math.abs(c.jy) > 0.05 * Math.max(...contacts.map((x) => Math.abs(x.jy)))).map((c) => (c.body1 === body ? c.owner1 : c.owner2)));
    // Turned counterclockwise, its low corner is its first column, the row that faces down.
    expect(owners.has('s0.0')).toBe(true);
    expect(owners.size).toBeLessThanOrEqual(3);
    pw.free();
  });

  it('each side of two boxes that meet reads its own cells, whichever came first', () => {
    for (const first of [true, false]) {
      const pw = new PhysicsWorld(0, 1 / 60);
      const make = (owner: string, x: number, vx: number): number => {
        const cells: MergeCell[] = [];
        for (let cx = 0; cx < 4; cx++) for (let cy = 0; cy < 4; cy++) cells.push({ x: cx, y: cy, owner: `${owner}${cx}.${cy}`, mass: 1 });
        const b = pw.createBody({ x, y: 0, kind: 'dynamic' });
        pw.addCellBox(b, mergeCells(cells, CELL_HALF)[0] as never, CELL_HALF, 0.3);
        void vx;
        return b;
      };
      const left = first ? make('l', -5, 0) : 0;
      const right = make('r', 2, 0);
      const l = first ? left : make('l', -5, 0);
      pw.step();
      pw.setVelocity(l, 40, 0, 0);
      let found: ContactImpulse[] = [];
      for (let i = 0; i < 20 && found.length === 0; i++) {
        pw.step();
        found = pw.contactImpulses([l]).filter((c) => Math.abs(c.jx) > 1);
      }
      expect(found.length).toBeGreaterThan(0);
      for (const c of found) {
        const mine = c.body1 === l ? c.owner1 : c.owner2;
        const theirs = c.body1 === l ? c.owner2 : c.owner1;
        expect(mine).toMatch(/^l3\./);
        expect(theirs).toMatch(/^r0\./);
      }
      expect(new Set(found.map((c) => (c.body1 === l ? c.owner1 : c.owner2))).size).toBe(4);
      expect(right).not.toBe(l);
      pw.free();
    }
  });
});

describe('how a contact spreads along its line', () => {
  const center = (s: number[]): number => s.reduce((sum, p, k) => sum + (p * (k + 0.5)) / s.length, 0);

  it('adds up to 1, even when both ends pushed the same', () => {
    expect(pressureShares(5, 5, 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    for (const [a, b, n] of [[1, 2, 7], [10, 0, 3], [0, 3, 1], [0, 0, 5]] as const) expect(pressureShares(a, b, n).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });

  it('keeps the center of pressure while it is in the middle third', () => {
    expect(center(pressureShares(2, 3, 40))).toBeCloseTo(0.6, 3);
    expect(center(pressureShares(3, 1, 40))).toBeCloseTo(0.25, 1);
  });

  it('a push from one end only stays at that end', () => {
    expect(pressureShares(1, 0, 10)[0]).toBe(1);
    expect(pressureShares(0, 1, 10)[9]).toBe(1);
    const nearly = pressureShares(1, 0.05, 10);
    expect(nearly[0]).toBeGreaterThan(0.3);
    expect(nearly[9]).toBe(0);
  });
});

describe('boxes of cells in a world', () => {
  const space = parseWorldFile({ name: 'space', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
  const slab = (cols: number, rows: number, fill: string, special: Record<string, string> = {}): string[] => {
    const grid: string[] = [];
    for (let y = rows - 1; y >= 0; y--) grid.push(Array.from({ length: cols }, (_, x) => (special[`${x},${y}`] ?? fill).padEnd(3)).join(''));
    return grid;
  };
  const colliders = (w: World): number => (w.physics as unknown as { world: { colliders: { len(): number } } }).world.colliders.len();
  const health = (r: Robot): number => [...r.parts.values()].reduce((s, p) => s + Math.max(0, p.health), 0);
  /** A ray from far left along a row: the part it meets first, whatever the robot's pose. */
  const firstOnRow = (w: World, r: Robot, y: number): string | undefined => {
    const s = w.physics.state(r.groups[0]?.bodyId ?? 0);
    return w.physics.castRay(s.x - 40, s.y + y, 1, 0, 80)?.owner;
  };

  it('a solid robot is a handful of colliders, and the world sees the same parts', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const before = colliders(w);
    const r = w.spawnBlueprint({ format: 1, name: 'slab', grid: slab(20, 10, 'F', { '0,5': 'C' }) }, { x: 0, y: 40 });
    w.step();
    expect(colliders(w) - before).toBe(1);
    expect(w.physics.colliderOwners().toSorted()).toEqual([...r.parts.keys()].toSorted());
    w.dispose();
  });

  it('a lost part splits its rectangle: rays pass where it was, the rest stay, and mass and inertia are the new shape\'s', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const before = colliders(w);
    const grid = slab(9, 5, 'F', { '0,2': 'C' });
    const r = w.spawnBlueprint({ format: 1, name: 'slab', grid }, { x: 0, y: 40 });
    w.step();
    expect(firstOnRow(w, r, 0)).toBe('core@0,2');
    // The part in the middle of the row of the core, then the core's own row reads through the hole from the right.
    const hole = r.parts.get('frame@4,2');
    if (!hole) throw new Error('no frame there');
    hole.health = 0;
    w.step();
    w.step();
    expect(r.parts.has('frame@4,2')).toBe(false);
    expect(colliders(w) - before).toBeGreaterThan(1);
    expect(colliders(w) - before).toBeLessThanOrEqual(5);
    const s = w.physics.state(r.groups[0]?.bodyId ?? 0);
    const hits = w.physics.rayHits(s.x + 40, s.y, -1, 0, 80).map((h) => h.owner);
    expect(hits).toEqual(['frame@8,2', 'frame@7,2', 'frame@6,2', 'frame@5,2', 'frame@3,2', 'frame@2,2', 'frame@1,2', 'core@0,2']);
    // The same shape spawned whole.
    const w2 = await World.create({ seed: 1, gravityY: 0 }, space);
    const same = w2.spawnBlueprint({ format: 1, name: 'slab', grid: slab(9, 5, 'F', { '0,2': 'C', '4,2': '.' }) }, { x: 0, y: 40 });
    w2.step();
    const m = w.physics.massProperties(r.groups[0]?.bodyId ?? 0);
    const n = w2.physics.massProperties(same.groups[0]?.bodyId ?? 0);
    expect(Math.abs(m.mass / n.mass - 1)).toBeLessThan(1e-5);
    expect(Math.abs(m.inertia / n.inertia - 1)).toBeLessThan(1e-5);
    w.dispose();
    w2.dispose();
  });

  it('runs the same twice: rams, lost parts and rebuilds on boxes give one hash', async () => {
    const run = async (): Promise<{ hash: string; lost: number }> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const target = w.spawnBlueprint({ format: 1, name: 'target', grid: slab(10, 14, 'F', { '9,7': 'C', '3,3': 'B', '4,3': 'B', '3,9': 'A' }) }, { x: 25, y: 40 }, { team: 1 });
      const ram = w.spawnBlueprint({ format: 1, name: 'ram', grid: slab(8, 8, 'F', { '0,4': 'C', '7,2': 'A', '7,5': 'B' }) }, { x: -15, y: 41 });
      w.kickRobot(ram, 90, 0);
      for (let i = 0; i < 180; i++) w.step();
      const lost = w.events.filter((e) => e.kind === 'partDestroyed').length;
      expect(target.id).not.toBe(ram.id);
      const hash = w.hash();
      w.dispose();
      return { hash, lost };
    };
    const first = await run();
    expect(first.lost).toBeGreaterThan(0);
    expect(await run()).toEqual(first);
  });

  it('a hit takes the hardness of the cell that touched, not of the box it is in', async () => {
    // Ten rows of frames with one column of armor or of batteries on the face: one rectangle each way.
    const faced = async (face: string): Promise<{ ram: number; target: number; boxes: number }> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const before = colliders(w);
      const special: Record<string, string> = { '0,5': 'C' };
      for (let y = 0; y < 10; y++) special[`9,${y}`] = face;
      const target = w.spawnBlueprint({ format: 1, name: 'target', grid: slab(10, 14, 'F', { '9,7': 'C' }) }, { x: 25, y: 40 }, { team: 1 });
      const ram = w.spawnBlueprint({ format: 1, name: 'ram', grid: slab(10, 10, 'F', special) }, { x: -15, y: 40 });
      w.step();
      const boxes = colliders(w) - before;
      const [ramFull, targetFull] = [health(ram), health(target)];
      w.kickRobot(ram, 50, 0);
      for (let i = 0; i < 90; i++) w.step();
      const out = { ram: health(ram) / ramFull, target: health(target) / targetFull, boxes };
      w.dispose();
      return out;
    };
    const soft = await faced('B');
    const hard = await faced('A');
    expect(soft.boxes).toBe(2);
    expect(hard.boxes).toBe(2);
    // Batteries (hardness 1) take most of it; armor (6) passes it on to the target's frames.
    expect(hard.ram).toBeGreaterThan(soft.ram);
    expect(hard.target).toBeLessThan(soft.target);
  });
});
