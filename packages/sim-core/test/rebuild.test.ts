import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { Prng } from '../src/rng/Prng';
import { parseWorldFile, type WorldFile } from '../src/world/WorldFile';
import type { RobotInput } from '../src/control/types';
import { World, type WorldEvent } from '../src/world/World';
import type { Robot } from '../src/world/Robot';

const flat = parseWorldFile(flatJson);
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

/**
 * A robot that only lost parts and stayed whole is rebuilt from what it kept of its last rebuild; anything else is
 * assembled from scratch (`assembly/rebuild.ts`). Both must give the same world, so every case here runs twice, once
 * with `fullRebuild` (always from scratch), and the two worlds are compared after every tick.
 */
interface Pair {
  kept: World;
  full: World;
  /** Steps both worlds with the same inputs and checks they are the same. */
  step(inputs?: readonly RobotInput[]): void;
  /** Sets parts to 0 health in both worlds; they go in the next tick's damage phase. */
  lose(robotId: number, ...partIds: string[]): void;
  dispose(): void;
}

/** Everything a rebuild decides about a robot. */
function shape(r: Robot): unknown {
  return {
    id: r.id,
    rootId: r.rootId,
    core: r.primaryCoreId,
    version: r.version,
    woke: r.woke,
    brokeFrom: r.brokeFrom,
    parts: [...r.parts.values()].map((p) => [p.id, p.group, p.localX, p.localY]),
    groups: r.groups.map((g) => ({ ...g, partIds: [...g.partIds] })),
    chunks: r.chunks,
  };
}

async function pair(file: WorldFile, opts: { gravityY?: number }, spawn: (w: World) => void): Promise<Pair> {
  const kept = await World.create({ seed: 5, ...opts }, file);
  const full = await World.create({ seed: 5, ...opts, fullRebuild: true }, file);
  spawn(kept);
  spawn(full);
  const check = (): void => {
    expect(kept.hash()).toBe(full.hash());
    expect(kept.robots.map(shape)).toEqual(full.robots.map(shape));
    // A robot holds its parts in blueprint order: rebuilds assemble them as held.
    for (const r of kept.robots) expect([...r.parts.keys()]).toEqual(r.blueprint.parts.map((q) => q.id).filter((id) => r.parts.has(id)));
    expect(full.rebuilds.whole).toBe(0);
  };
  check();
  return {
    kept,
    full,
    step(inputs = []) {
      kept.step(inputs);
      full.step(inputs);
      check();
    },
    lose(robotId, ...partIds) {
      for (const w of [kept, full]) {
        for (const id of partIds) {
          const p = w.robotById(robotId)?.parts.get(id);
          if (!p) throw new Error(`robot ${robotId} has no part ${id}`);
          p.health = 0;
        }
      }
    },
    dispose() {
      kept.dispose();
      full.dispose();
    },
  };
}

const kinds = (w: World, kind: WorldEvent['kind']): number => w.events.filter((e) => e.kind === kind).length;
const ids = (r: Robot | undefined): string[] => [...(r?.parts.keys() ?? [])];

/** A 6 by 4 slab of frames, the core in its bottom left corner. */
const SLAB = { format: 1, name: 'slab', grid: ['F F F F F F', 'F F F F F F', 'F F F F F F', 'C F F F F F'] };

describe('rebuilding a robot that lost parts', () => {
  it('a part lost with no split: after the first rebuild the robot is rebuilt from what it kept', async () => {
    const p = await pair(space, { gravityY: 0 }, (w) => {
      const r = w.spawnBlueprint(SLAB, { x: 0, y: 20 });
      w.kickRobot(r, 2, 1, 0.5);
    });
    for (let i = 0; i < 3; i++) p.step();
    // The first loss: nothing kept yet, so it is assembled. From then on it knows its welds.
    p.lose(1, 'frame@5,3');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 0, assembled: 1 });
    // A corner, a part in the middle (it leaves a hole), and a part of the edge.
    for (const id of ['frame@0,3', 'frame@2,2', 'frame@3,0']) {
      p.lose(1, id);
      p.step();
      p.step();
    }
    expect(p.kept.rebuilds).toEqual({ whole: 3, assembled: 1 });
    expect(p.full.rebuilds).toEqual({ whole: 0, assembled: 4 });
    expect(p.kept.robots).toHaveLength(1);
    expect(p.kept.robots[0]?.parts.size).toBe(20);
    expect(p.kept.robots[0]?.groups[0]?.partIds).toHaveLength(20);
    for (let i = 0; i < 30; i++) p.step();
    p.dispose();
  });

  it('a part lost that splits the robot in two, one piece with the core: assembled, and both pieces keep their welds', async () => {
    const p = await pair(space, { gravityY: 0 }, (w) => {
      const r = w.spawnBlueprint({ format: 1, name: 'bar', grid: ['C F F F F F F F'] }, { x: 0, y: 20 });
      w.kickRobot(r, 1, 0, 0.8);
    });
    p.step();
    p.lose(1, 'frame@7,0');
    p.step();
    p.lose(1, 'frame@6,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    // The cut: a search from one neighbor of the lost part never reaches the other.
    p.lose(1, 'frame@2,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 2 });
    expect(p.kept.robots.map(ids)).toEqual([
      ['core@0,0', 'frame@1,0'],
      ['frame@3,0', 'frame@4,0', 'frame@5,0'],
    ]);
    expect(p.kept.robots[1]?.primaryCoreId).toBeUndefined();
    expect(kinds(p.kept, 'split')).toBe(1);
    // Each piece now loses an end and stays whole: both kept their welds from the split.
    p.lose(1, 'frame@1,0');
    p.lose(2, 'frame@5,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 3, assembled: 2 });
    for (let i = 0; i < 20; i++) p.step();
    p.dispose();
  });

  it('a part lost that splits the robot into two pieces that both have cores: the second core wakes', async () => {
    const p = await pair(space, { gravityY: 0 }, (w) => {
      w.spawnBlueprint({ format: 1, name: 'twin', grid: ['F F F F F', 'C F F F C'] }, { x: 0, y: 20 });
    });
    p.step();
    p.lose(1, 'frame@2,1');
    p.step();
    p.lose(1, 'frame@2,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 0, assembled: 2 });
    expect(p.kept.robots.map(ids)).toEqual([
      ['frame@0,1', 'frame@1,1', 'core@0,0', 'frame@1,0'],
      ['frame@3,1', 'frame@4,1', 'frame@3,0', 'core@4,0'],
    ]);
    expect(p.kept.robots[1]?.primaryCoreId).toBe('core@4,0');
    expect(p.kept.robots[1]?.woke).toBe(true);
    expect(kinds(p.kept, 'coreWoke')).toBe(1);
    // Losing the first core leaves robot 1 whole and coreless; the piece that woke loses a frame and stays whole.
    p.lose(1, 'core@0,0');
    p.lose(2, 'frame@3,1');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 2 });
    expect(p.kept.robots[0]?.primaryCoreId).toBeUndefined();
    expect(p.kept.robots[0]?.rootId).toBe('frame@0,1');
    expect(p.kept.robots[0]?.chunks[0]?.coreId).toBeUndefined();
    expect(p.kept.robots[1]?.rootId).toBe('core@4,0');
    expect(kinds(p.kept, 'coreLost')).toBe(1);
    for (let i = 0; i < 20; i++) p.step();
    p.dispose();
  });

  it('a robot whose active core is not its first core stays rooted at the active one', async () => {
    const p = await pair(space, { gravityY: 0 }, (w) => {
      w.spawnBlueprint({ format: 1, name: 'second-core', grid: ['F F F F', 'C F F C'], primaryCore: 'core@3,0' }, { x: 0, y: 20 });
    });
    p.step();
    p.lose(1, 'frame@0,1');
    p.step();
    p.lose(1, 'frame@1,1');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    expect(p.kept.robots[0]?.rootId).toBe('core@3,0');
    expect(p.kept.robots[0]?.groups[0]?.originId).toBe('core@3,0');
    // The active core goes: the robot is rooted at the core it has left, which stays asleep.
    p.lose(1, 'core@3,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 1 });
    expect(p.kept.robots[0]?.rootId).toBe('core@0,0');
    expect(p.kept.robots[0]?.primaryCoreId).toBeUndefined();
    expect(p.kept.robots[0]?.chunks[0]?.coreId).toBe('core@0,0');
    p.dispose();
  });

  it('a decoupler firing cuts a face, so the robot is assembled again', async () => {
    const stack = { format: 1, name: 'stack', grid: ['F F F', '. D .', 'C F F'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] };
    const p = await pair(space, { gravityY: 0 }, (w) => {
      w.spawnBlueprint(stack, { x: 0, y: 20 });
    });
    p.step();
    p.lose(1, 'frame@2,2');
    p.step();
    p.lose(1, 'frame@2,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    // Its release face is north: the two frames left on top come off.
    p.step([{ robot: 1, pressed: ['f'], released: [] }]);
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 2 });
    expect(kinds(p.kept, 'decoupled')).toBe(1);
    expect(p.kept.robots.map(ids)).toEqual([
      ['decoupler@1,1', 'core@0,0', 'frame@1,0'],
      ['frame@0,2', 'frame@1,2'],
    ]);
    // The cut is part of what each piece keeps: a later loss is found whole again.
    p.lose(2, 'frame@0,2');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 2 });
    for (let i = 0; i < 20; i++) p.step();
    p.dispose();
  });

  it('a fabricator bay finishing a copy and letting it go: assembled both times, kept in between', async () => {
    const bayBot = {
      format: 1,
      name: 'bay-bot',
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'densebattery', x: -1, y: 0 },
        { part: 'densebattery', x: 1, y: 0 },
        { part: 'frame', x: 2, y: 0 },
        { part: 'frame', x: 3, y: 0 },
        { part: 'frame', x: 4, y: 0 },
        { part: 'frame', x: 5, y: 0 },
        { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
      ],
      recipes: { item: { format: 1, name: 'post', grid: ['F', 'F', 'C'] } },
      bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
    };
    const p = await pair(flat, {}, (w) => {
      w.spawnBlueprint(bayBot, { x: 0, y: 0.5 });
    });
    p.step();
    p.lose(1, 'frame@5,0');
    p.step();
    p.lose(1, 'frame@4,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    // The copy is finished: the robot grew parts, held by the bay's grips.
    let ticks = 0;
    while (kinds(p.kept, 'built') === 0 && ticks++ < 600) p.step();
    expect(kinds(p.kept, 'built')).toBe(1);
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 2 });
    expect(p.kept.robots).toHaveLength(1);
    const held = ['frame@0,4', 'frame@0,3', 'core@0,2'];
    expect(ids(p.kept.robots[0]).slice(-3)).toEqual(held);
    // Holding it, the robot loses a frame, then a part of the copy: both leave it whole.
    p.lose(1, 'frame@3,0');
    p.step();
    p.lose(1, held[0] as string);
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 3, assembled: 2 });
    // It lets go: the copy is its own robot and its core wakes.
    p.step([{ robot: 1, pressed: ['r'], released: [] }]);
    expect(kinds(p.kept, 'released')).toBe(1);
    expect(p.kept.rebuilds).toEqual({ whole: 3, assembled: 3 });
    expect(p.kept.robots).toHaveLength(2);
    expect(p.kept.robots[1]?.woke).toBe(true);
    // The copy loses its other frame, the base its last one: both whole.
    p.lose(2, held[1] as string);
    p.lose(1, 'frame@2,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 5, assembled: 3 });
    for (let i = 0; i < 60; i++) p.step();
    p.dispose();
  });

  it('many parts lost in the same tick: a block out of the middle, a cut all the way across, and a blast', async () => {
    const wide = { format: 1, name: 'wide', grid: ['F F F F F F F F F', 'F F F F F F F F F', 'F F F F x F F F F', 'C F F F F F F F F'], legend: { x: { part: 'warhead', armed: true } } };
    const p = await pair(space, { gravityY: 0 }, (w) => {
      w.spawnBlueprint(wide, { x: 0, y: 20 });
    });
    p.step();
    p.lose(1, 'frame@8,3');
    p.step();
    // Four parts at once, two of them side by side: still one piece.
    p.lose(1, 'frame@0,3', 'frame@1,3', 'frame@1,2', 'frame@8,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    expect(p.kept.robots).toHaveLength(1);
    // A whole column: the right end comes off.
    p.lose(1, 'frame@7,3', 'frame@7,2', 'frame@7,1', 'frame@7,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 2 });
    expect(p.kept.robots.map((r) => r.parts.size)).toEqual([25, 2]);
    // The warhead goes off: its blast takes the parts around it in the same tick, in a second rebuild.
    p.lose(1, 'warhead@4,1');
    p.step();
    expect(kinds(p.kept, 'explosion')).toBe(1);
    expect(p.kept.rebuilds.whole + p.kept.rebuilds.assembled).toBeGreaterThanOrEqual(5);
    expect(p.kept.rebuilds.whole + p.kept.rebuilds.assembled).toBe(p.full.rebuilds.assembled);
    for (let i = 0; i < 30; i++) p.step();
    p.dispose();
  });

  it('joints: a turret that becomes the second body, a lost wheel, a lost mount', async () => {
    // The rotator sits on the core and carries the frame above it; the column on the right is part of the base.
    const car = { format: 1, name: 'turret-car', grid: ['F . F F', 'R . F .', 'C B F F', 'W . . W'] };
    const p = await pair(flat, {}, (w) => {
      w.spawnBlueprint(car, { x: 0, y: 1.5 });
    });
    p.step([{ robot: 1, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 20; i++) p.step();
    const groups = (): string[][] => (p.kept.robots[0]?.groups ?? []).map((g) => g.partIds);
    const base = ['frame@2,3', 'frame@2,2', 'core@0,1', 'battery@1,1', 'frame@2,1', 'frame@3,1'];
    p.lose(1, 'frame@3,3');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 0, assembled: 1 });
    expect(groups()).toEqual([['frame@0,3', 'rotator@0,2'], base, ['wheel@0,0'], ['wheel@3,0']]);
    // The turret's first part goes: its body now starts at the rotator, after the base's first part, so the two
    // bodies change places (groups go by their first part) and every joint hangs from body 0.
    p.lose(1, 'frame@0,3');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 1, assembled: 1 });
    expect(groups()).toEqual([base, ['rotator@0,2'], ['wheel@0,0'], ['wheel@3,0']]);
    expect(p.kept.robots[0]?.groups.map((g) => g.joint?.parentGroup)).toEqual([undefined, 0, 0, 0]);
    expect(p.kept.robots[0]?.parts.get('rotator@0,2')?.group).toBe(1);
    // The base's first part goes, and they change back.
    p.lose(1, 'frame@2,3');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 1 });
    expect(groups()).toEqual([['rotator@0,2'], base.slice(1), ['wheel@0,0'], ['wheel@3,0']]);
    expect(p.kept.robots[0]?.groups.map((g) => g.joint?.parentGroup)).toEqual([1, undefined, 1, 1]);
    for (let i = 0; i < 10; i++) p.step();
    // A wheel is one end of a joint: assembled, though nothing splits.
    p.lose(1, 'wheel@0,0');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 2 });
    expect(p.kept.robots).toHaveLength(1);
    // So is the frame the other wheel hangs from: the wheel is a piece of its own.
    p.lose(1, 'frame@3,1');
    p.step();
    expect(p.kept.rebuilds).toEqual({ whole: 2, assembled: 3 });
    expect(p.kept.robots.map(ids)).toEqual([['rotator@0,2', 'frame@2,2', 'core@0,1', 'battery@1,1', 'frame@2,1'], ['wheel@3,0']]);
    for (let i = 0; i < 60; i++) p.step();
    p.dispose();
  });

  it('a long fight with random damage ends the same both ways', async () => {
    const bindings = [
      { key: 'f', mode: 'hold', target: 'gun', channel: 'fire', value: 1 },
      { key: 'g', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
    ];
    const legend = { 'g>': { part: 'gun', rot: 270, tags: ['gun'] }, 'g<': { part: 'gun', rot: 90, tags: ['gun'] }, x: { part: 'warhead', armed: true } };
    /**
     * A wall 18 wide and 10 tall on four wheels: guns down the side facing the other wall, a turret on the roof, two
     * decouplers under the top row, a warhead in the far top corner, the core low at the back.
     */
    const wall = (facing: 'right' | 'left'): unknown => {
      const rows: string[][] = [];
      const roof = Array.from({ length: 19 }, () => '.');
      rows.push(roof.map((c, x) => (x === 5 ? 'F' : c)), roof.map((c, x) => (x === 5 ? 'R' : c)));
      for (let y = 0; y < 10; y++) {
        const row: string[] = [];
        for (let x = 0; x < 18; x++) row.push(y === 1 && (x === 3 || x === 12) ? 'D' : y === 0 && x === 1 ? 'x' : y === 8 && x === 0 ? 'C' : y === 8 && x === 1 ? 'B' : 'F');
        row.push(y % 2 === 0 ? 'g>' : '.');
        rows.push(row);
      }
      rows.push(Array.from({ length: 19 }, (_, x) => (x === 0 || x === 5 || x === 12 || x === 17 ? 'W' : '.')));
      const grid = rows.map((row) => (facing === 'right' ? row : [...row].reverse().map((c) => (c === 'g>' ? 'g<' : c))).join(' '));
      return { format: 1, name: `wall-${facing}`, grid, legend, bindings };
    };
    const p = await pair(flat, {}, (w) => {
      w.spawnBlueprint(wall('right'), { x: -30, y: 1.5 }, { team: 1 });
      w.spawnBlueprint(wall('left'), { x: 30, y: 1.5 }, { team: 2 });
    });
    const rng = new Prng(99);
    // Both fire and roll at each other.
    p.step([
      { robot: 1, pressed: ['f', 'd'], released: [] },
      { robot: 2, pressed: ['f', 'a'], released: [] },
    ]);
    for (let t = 0; t < 600; t++) {
      // On half the ticks a random part goes, on some two; every 40th tick a clump of neighbors in blueprint order.
      const all = p.kept.robots.flatMap((r) => ids(r).map((id) => ({ robot: r.id, id })));
      const count = t % 40 === 39 ? 5 : rng.next() < 0.05 ? 2 : rng.next() < 0.4 ? 1 : 0;
      const first = Math.floor(rng.next() * all.length);
      for (let k = 0; k < count && all.length > 0; k++) {
        const pick = t % 40 === 39 ? all[(first + k) % all.length] : all[Math.floor(rng.next() * all.length)];
        if (pick) p.lose(pick.robot, pick.id);
      }
      const fire = (t === 30 || t === 90) && p.kept.robotById(1)?.primaryCoreId !== undefined;
      p.step(fire ? [{ robot: 1, pressed: ['g'], released: [] }] : []);
    }
    // The run went through both ways of rebuilding, many times, and through splits.
    expect(p.kept.rebuilds.whole).toBeGreaterThan(100);
    expect(p.kept.rebuilds.assembled).toBeGreaterThan(50);
    expect(kinds(p.kept, 'split')).toBeGreaterThan(20);
    expect(kinds(p.kept, 'explosion')).toBeGreaterThan(0);
    expect(kinds(p.kept, 'decoupled')).toBeGreaterThan(0);
    expect(p.kept.robots.length).toBeGreaterThan(0);
    expect(p.full.rebuilds.assembled).toBe(p.kept.rebuilds.whole + p.kept.rebuilds.assembled);
    p.dispose();
  }, 60000);
});
