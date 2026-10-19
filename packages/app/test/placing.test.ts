import { describe, expect, it } from 'vitest';
import { World, buildReplay, defaultRegistry, expandBlueprint, parseReplay, parseWorldFile, placeBlueprint, runReplay, type Blueprint } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { controlCores, controlsOf, withControls } from '../src/builder/coreControls';
import { placeStamp, stampGhost, type Stamp } from '../src/builder/stamp';
import { initialEditor, reduce, type EditorEvent } from '../src/builder/editorState';
import { placePress, placingLine } from '../src/world/placing';

const reg = defaultRegistry();
const bp = (raw: unknown): Blueprint => {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
};
const missile = bp({ format: 1, name: 'missile', grid: ['T> C  X'], bindings: [{ key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 }], scripts: [{ id: 'guide', source: 'function tick() {}' }] });
const car = bp({ format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] });
const off = { on: false, axisHalfCells: 0 };
const stamp = (over: Partial<Stamp> = {}): Stamp => ({ name: 'missile', bp: missile, rot: 0, flipped: false, ...over });
const cells = (b: Blueprint, from: number): string[] => b.parts.slice(from).map((p) => `${p.part}@${p.x},${p.y}:${p.rot}`);

describe('placing a held blueprint (M7)', () => {
  it('places a copy with its core on the cell, as placeBlueprint does', () => {
    const r = placeStamp(car, stamp(), { x: 2, y: 2 }, off, reg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(cells(r.bp, car.parts.length)).toEqual(['thruster@1,2:270', 'core@2,2:0', 'warhead@3,2:0']);
    expect(r.bp.cores?.[0]?.scope).toBe('missile1');
  });

  it('turns and flips the held copy', () => {
    const turned = placeStamp(car, stamp({ rot: 90 }), { x: 2, y: 3 }, off, reg);
    expect(turned.ok && cells(turned.bp, car.parts.length)).toEqual(['thruster@2,2:0', 'core@2,3:90', 'warhead@2,4:90']);
    const flipped = placeStamp(car, stamp({ flipped: true }), { x: 2, y: 2 }, off, reg);
    expect(flipped.ok && cells(flipped.bp, car.parts.length)).toEqual(['thruster@3,2:90', 'core@2,2:0', 'warhead@1,2:0']);
  });

  it('in mirror mode also places the mirror image across the axis, as one change', () => {
    const r = placeStamp(car, stamp(), { x: 1, y: 3 }, { on: true, axisHalfCells: 5 }, reg);
    expect(r.ok && cells(r.bp, car.parts.length)).toEqual(['thruster@0,3:270', 'core@1,3:0', 'warhead@2,3:0', 'thruster@5,3:90', 'core@4,3:0', 'warhead@3,3:0']);
    expect(r.ok && r.bp.cores?.map((c) => c.scope)).toEqual(['missile1', 'missile2']);
  });

  it('refuses an overlap, and the ghost still shows where it would go, marked refused', () => {
    expect(placeStamp(car, stamp(), { x: 2, y: 1 }, off, reg)).toEqual({ ok: false, error: 'missile would overlap frame@1,1 at (1, 1)' });
    const g = stampGhost(car, stamp(), { x: 2, y: 1 }, off, reg);
    expect(g.ok).toBe(false);
    expect(g.parts.map((p) => `${p.x},${p.y}`)).toEqual(['1,1', '2,1', '3,1']);
    expect(stampGhost(car, stamp(), { x: 2, y: 2 }, off, reg).ok).toBe(true);
  });
});

describe('the builder holds and places a blueprint (M7)', () => {
  const run = (events: EditorEvent[], start: Blueprint = car) => {
    let editor = initialEditor();
    let b = start;
    const changes: Blueprint[] = [];
    let refused: string | undefined;
    for (const e of events) {
      const r = reduce(editor, b, e, reg, reg.ids());
      if (r.bp !== b) changes.push(r.bp);
      editor = r.editor;
      b = r.bp;
      refused = r.refused;
      expect(r.gesture).toBeUndefined();
    }
    return { editor, bp: b, changes, refused };
  };

  it('R turns it, F flips it, a click places it as one change, and it stays held for the next', () => {
    const r = run([{ type: 'holdBlueprint', name: 'missile', bp: missile }, { type: 'rotate', dir: 1 }, { type: 'flip' }, { type: 'down', cell: { x: 2, y: 3 }, button: 'left', shift: false }, { type: 'up', cell: { x: 2, y: 3 } }]);
    expect(r.changes).toHaveLength(1);
    expect(r.editor.stamp).toMatchObject({ name: 'missile', rot: 90, flipped: true });
    expect(r.bp.cores?.[0]?.scope).toBe('missile1');
  });

  it('a refused click changes nothing and says why; Esc or picking a part lets go', () => {
    const r = run([{ type: 'holdBlueprint', name: 'missile', bp: missile }, { type: 'down', cell: { x: 2, y: 1 }, button: 'left', shift: false }]);
    expect(r.changes).toEqual([]);
    expect(r.refused).toBe('Missile would overlap frame@1,1 at (1, 1).');
    expect(run([{ type: 'holdBlueprint', name: 'missile', bp: missile }, { type: 'escape' }]).editor.stamp).toBeUndefined();
    const picked = run([{ type: 'holdBlueprint', name: 'missile', bp: missile }, { type: 'hold', part: 'frame' }]).editor;
    expect([picked.stamp, picked.held?.part]).toEqual([undefined, 'frame']);
  });
});

describe("each core's controls (M7)", () => {
  const placed = placeBlueprint(car, missile, { x: 2, y: 2 }, reg);
  if (!placed.ok) throw new Error(placed.error);
  const withMissile = placed.blueprint;

  it('lists the main core first, then every other core by its scope', () => {
    expect(controlCores(withMissile, reg)).toEqual([{ label: 'main core' }, { core: 'core@2,2', label: 'missile1 (core@2,2)' }]);
    expect(controlCores(car, reg)).toEqual([{ label: 'main core' }]);
  });

  it('reads and writes the right entry', () => {
    const view = controlsOf(withMissile, reg, 'core@2,2');
    expect(view).toMatchObject({ core: 'core@2,2', scope: 'missile1', autoOn: true });
    expect(view.bindings.map((b) => b.key)).toEqual(['x']);
    const edited = withControls(withMissile, reg, 'core@2,2', { bindings: [], autoOn: false });
    expect(edited.cores).toEqual([{ core: 'core@2,2', scope: 'missile1', bindings: [], scripts: view.scripts, autoControls: false }]);
    expect(edited.bindings).toEqual(withMissile.bindings);
    // The main core is the top level.
    const main = withControls(withMissile, reg, undefined, { autoOn: false });
    expect(main.autoControls).toBe(false);
    expect(controlsOf(main, reg, 'core@2,1')).toMatchObject({ autoOn: false });
  });

  it('adding controls to a core that had none creates its entry; emptying it drops the entry', () => {
    const twoCores = bp({ format: 1, name: 't', grid: ['C  F  C'] });
    const added = withControls(twoCores, reg, 'core@2,0', { bindings: [{ key: 'k', mode: 'hold', target: 'core', channel: 'x', value: 1 }] });
    expect(added.cores?.map((c) => c.core)).toEqual(['core@2,0']);
    expect(withControls(added, reg, 'core@2,0', { bindings: [] }).cores).toBeUndefined();
  });
});

describe('placing robots in the world', () => {
  it('a click drops one and stops placing; Shift+click drops one and keeps the same robot in hand', () => {
    expect(placePress(0, false, true)).toBe('drop');
    expect(placePress(0, true, true)).toBe('drop-and-keep');
  });

  it('a click where it does not fit drops nothing and keeps it in hand, Shift or not', () => {
    expect(placePress(0, false, false)).toBe('nothing');
    expect(placePress(0, true, false)).toBe('nothing');
  });

  it('a right click stops placing, as it puts the remove cursor away; the middle button still drags the view', () => {
    expect(placePress(2, false, true)).toBe('stop');
    expect(placePress(2, true, false)).toBe('stop');
    expect(placePress(1, false, true)).toBe('pass');
  });

  it('the line while placing says what a click, Shift+click, Esc and a right click do', () => {
    expect(placingLine({ name: 'drone', team: 0, flip: false, rot: 0, ok: true })).toBe('PLACING drone as Yours: click to drop   Shift+click keeps placing   F flips   R turns   Esc or right click stops   fits here');
    expect(placingLine({ name: 'car', team: 1, flip: true, rot: 90, ok: false, reason: 'overlaps something already in the world' })).toBe(
      'PLACING car as Enemy, flipped, turned 90: click to drop   Shift+click keeps placing   F flips   R turns   Esc or right click stops   blocked: overlaps something already in the world',
    );
    expect(placingLine({ name: 'car', team: 0, flip: false, rot: 0, ok: false })).toMatch(/blocked: move the cursor into the world$/);
  });

  it('several dropped on one paused tick each go in the replay, one on top of another is refused, and the replay reruns them', async () => {
    const w = await World.create({ seed: 5 }, parseWorldFile(flatJson));
    const spots = [{ x: -40, y: 2 }, { x: -30, y: 2 }, { x: -20, y: 2 }];
    for (const at of spots) {
      expect(w.canPlace(carJson, at).ok).toBe(true);
      w.spawnBlueprint(carJson, at, { team: 1 });
    }
    // A fast second click on the same spot: the robot just dropped is already in the way, before any tick.
    expect(w.canPlace(carJson, { x: -20, y: 2 })).toEqual({ ok: false, reason: 'overlaps something already in the world' });
    for (let i = 0; i < 120; i++) w.step();
    const replay = buildReplay(w);
    expect(replay.spawns.map((s) => [s.tick, s.at.x, s.team])).toEqual([[0, -40, 1], [0, -30, 1], [0, -20, 1]]);
    const r = await runReplay(parseReplay(JSON.parse(JSON.stringify(replay))));
    expect(r.matches).toBe(true);
    expect(r.world.robots.map((x) => x.team)).toEqual([1, 1, 1]);
    r.world.dispose();
    w.dispose();
  });
});
