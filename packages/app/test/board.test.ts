import { describe, expect, it } from 'vitest';
import { blankBlueprint, defaultRegistry, expandBlueprint, type Blueprint } from '@robots/sim-core';
import { History } from '../src/builder/history';
import { initialEditor, reduce, type EditorEvent, type EditorState, type ReduceResult } from '../src/builder/editorState';
import { groupOffers, mirrorTwin, swapParts, type Fx } from '../src/builder/boardOps';
import { editNote } from '../src/builder/notice';
import { applyNameFix, partInputs, scriptProblems, showScript } from '../src/builder/scriptView';

const reg = defaultRegistry();
const HOTBAR = reg.ids();

function bp(raw: Record<string, unknown>): Blueprint {
  const r = expandBlueprint({ format: 1, name: 't', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

/** Drives the reducer the way the builder does, history and all, so undo steps can be counted. */
function drive(start: Blueprint = blankBlueprint('t'), editor: EditorState = initialEditor()) {
  const history = new History(start);
  let ed = editor;
  let last: ReduceResult | undefined;
  const fx: Fx[] = [];
  /** Why an edit of the last `send` did not happen, if one did not. */
  let refused: string | undefined;
  const send = (...events: EditorEvent[]) => {
    refused = undefined;
    for (const e of events) {
      const r = reduce(ed, history.present, e, reg, HOTBAR);
      ed = r.editor;
      if (r.gesture === 'begin') history.beginGesture();
      history.commit(r.bp);
      if (r.gesture === 'end') history.endGesture();
      if (r.fx) fx.push(r.fx);
      if (r.refused !== undefined) refused = r.refused;
      last = r;
    }
    return api;
  };
  const api = {
    send,
    get bp() {
      return history.present;
    },
    get editor() {
      return ed;
    },
    get refused() {
      return refused;
    },
    get last() {
      return last;
    },
    fx,
    history,
    /** How many undo steps there are. */
    steps() {
      let n = 0;
      const h = history;
      while (h.undo()) n++;
      for (let i = 0; i < n; i++) h.redo();
      return n;
    },
  };
  return api;
}

const down = (x: number, y: number, o: { shift?: boolean; alt?: boolean; right?: boolean } = {}): EditorEvent => ({ type: 'down', cell: { x, y }, button: o.right ? 'right' : 'left', shift: o.shift === true, alt: o.alt === true });
const move = (x: number, y: number): EditorEvent => ({ type: 'move', cell: { x, y } });
const up = (x: number, y: number): EditorEvent => ({ type: 'up', cell: { x, y } });
const click = (x: number, y: number, o: { shift?: boolean; alt?: boolean } = {}): EditorEvent[] => [down(x, y, o), up(x, y)];
const drag = (a: [number, number], b: [number, number], o: { shift?: boolean } = {}): EditorEvent[] => [down(a[0], a[1], o), move(b[0], b[1]), up(b[0], b[1])];
const cells = (b: Blueprint): string[] => b.parts.map((p) => `${p.part}@${p.x},${p.y}:${p.rot}`);
const tagsOf = (b: Blueprint, id: string): string[] => (b.parts.find((p) => p.id === id)?.tags ?? []).filter((t) => t !== id);

/** A drone with tagged propellers, a gun set to no auto keys, a key, and a script. */
const drone = (): Blueprint =>
  bp({
    grid: ['l  F  C  F  r', '.  .  g  .  .'],
    legend: { l: { part: 'propeller', tags: ['lprop', 'props'] }, r: { part: 'propeller', tags: ['rprop', 'props'] }, g: { part: 'gun', rot: 270, tags: ['guns'], auto: false } },
    bindings: [{ key: 'f', mode: 'hold', target: 'guns', channel: 'fire', value: 1 }],
    scripts: [{ id: 'hover', source: "function tick() { set('lprop', 'throttle', 1); set('rprop', 'throttle', 1); set('guns', 'fire', 0); }" }],
  });

describe('hand full: a click or a drag places on empty cells', () => {
  it('a taken cell refuses the part and says why; nothing changes', () => {
    const d = drive(drone()).send({ type: 'hold', part: 'frame' }, ...click(2, 0));
    expect(d.bp).toBe(d.history.present);
    expect(cells(d.bp)).toEqual(cells(drone()));
    expect(d.refused).toBe('That cell is taken by a gun. Hold Shift to swap it for the frame.');
    expect(d.steps()).toBe(0);
    // The same part already standing there is not a refusal: a drag passes over what it painted.
    const again = drive().send({ type: 'hold', part: 'frame' }, ...click(0, 0), ...click(0, 0));
    expect(again.refused).toBeUndefined();
    expect(again.steps()).toBe(1);
  });

  it('a drag is one undo step, and skips the taken cells it crosses', () => {
    const d = drive(drone()).send({ type: 'hold', part: 'frame' }, ...drag([0, 0], [4, 0]));
    expect(cells(d.bp).slice(6)).toEqual(['frame@0,0:0', 'frame@1,0:0', 'frame@3,0:0', 'frame@4,0:0']);
    expect(d.bp.parts.find((p) => p.x === 2 && p.y === 0)?.part).toBe('gun');
    expect(d.steps()).toBe(1);
    d.history.undo();
    expect(cells(d.bp)).toEqual(cells(drone()));
  });

  it('Shift swaps what is there: its groups and the settings that apply stay, as one step', () => {
    const d = drive(drone()).send({ type: 'hold', part: 'propeller' }, ...click(4, 1, { shift: true }));
    // The same type: nothing to do. Now a thruster over the left propeller.
    expect(d.steps()).toBe(0);
    d.send({ type: 'hold', part: 'thruster' }, ...click(0, 1, { shift: true }));
    expect(d.bp.parts[0]).toMatchObject({ id: 'thruster@0,1', part: 'thruster' });
    expect(tagsOf(d.bp, 'thruster@0,1')).toEqual(['lprop', 'props']);
    expect(d.steps()).toBe(1);
    expect(d.fx.at(-1)?.swaps?.[0]?.report).toMatchObject({ from: 'propeller', to: 'thruster', kept: { tags: ['lprop', 'props'] } });
    // The gun becomes a cannon, turned as the cannon in hand is.
    d.send({ type: 'hold', part: 'cannon' }, { type: 'rotate', dir: -1 }, ...click(2, 0, { shift: true }));
    expect(d.bp.parts.find((p) => p.part === 'cannon')).toMatchObject({ rot: 270 });
    expect(tagsOf(d.bp, 'cannon@2,0')).toEqual(['guns']);
    // The key that named the group still means it.
    expect(d.bp.bindings[0]?.target).toBe('guns');
  });

  it('R and Shift+R turn what is held; Esc and a right-click put it down', () => {
    const d = drive().send({ type: 'hold', part: 'thruster' }, { type: 'rotate', dir: 1 }, { type: 'rotate', dir: -1 }, { type: 'rotate', dir: -1 });
    expect(d.editor.held).toEqual({ part: 'thruster', rot: 270 });
    expect(drive().send({ type: 'hold', part: 'thruster' }, { type: 'escape' }).editor.held).toBeUndefined();
    expect(drive().send({ type: 'hold', part: 'thruster' }, down(0, 0, { right: true })).editor.held).toBeUndefined();
  });

  it('the eraser removes what a drag passes, as one step', () => {
    const d = drive(drone()).send({ type: 'eraser' }, ...drag([0, 1], [2, 1]));
    expect(cells(d.bp)).toEqual(['frame@3,1:0', 'propeller@4,1:0', 'gun@2,0:270']);
    expect(d.steps()).toBe(1);
  });
});

describe('hand empty: clicks select, drags move or box', () => {
  it('a click selects, Shift+click adds and removes, a click on one of several narrows to it', () => {
    const d = drive(drone()).send(...click(0, 1));
    expect(d.editor.selection).toEqual(['propeller@0,1']);
    d.send(...click(4, 1, { shift: true }));
    expect(d.editor.selection).toEqual(['propeller@0,1', 'propeller@4,1']);
    d.send(...click(0, 1, { shift: true }));
    expect(d.editor.selection).toEqual(['propeller@4,1']);
    d.send(...click(0, 1, { shift: true }), ...click(0, 1));
    expect(d.editor.selection).toEqual(['propeller@0,1']);
    // A click on an empty cell lets go.
    d.send(...click(9, 9));
    expect(d.editor.selection).toEqual([]);
    expect(d.steps()).toBe(0);
  });

  it('a drag across empty cells selects what the box covers, as it goes; Shift keeps what was selected', () => {
    const d = drive(drone()).send(down(-1, 2), move(1, 1));
    expect(d.editor.selection).toEqual(['propeller@0,1', 'frame@1,1']);
    expect(d.editor.gesture?.kind).toBe('box');
    d.send(move(2, 0), up(2, 0));
    expect(d.editor.selection).toEqual(['propeller@0,1', 'frame@1,1', 'core@2,1', 'gun@2,0']);
    d.send(down(5, 2, { shift: true }), move(4, 1), up(4, 1));
    expect(d.editor.selection).toEqual(['propeller@0,1', 'frame@1,1', 'core@2,1', 'gun@2,0', 'propeller@4,1']);
    // Esc in the middle of a box calls it off.
    d.send({ type: 'escape' }, down(5, 2), move(0, 0), { type: 'escape' });
    expect(d.editor.selection).toEqual([]);
    expect(d.editor.gesture).toBeUndefined();
  });

  it('dragging a selected part moves the selection on release, groups and settings and keys with it, as one step', () => {
    const start = { ...drone(), bindings: [{ key: 'f', mode: 'hold' as const, target: 'gun@2,0', channel: 'fire', value: 1 }] };
    const d = drive(start).send(...click(2, 0), down(2, 0), move(2, -1), move(3, -1));
    // Nothing moves while it is dragged.
    expect(d.bp).toBe(start);
    expect(d.editor.gesture).toMatchObject({ kind: 'move', ids: ['gun@2,0'] });
    d.send(up(3, -1));
    const gun = d.bp.parts.find((p) => p.part === 'gun');
    expect(gun).toMatchObject({ id: 'gun@3,-1', x: 3, y: -1, rot: 270, auto: false });
    expect(tagsOf(d.bp, 'gun@3,-1')).toEqual(['guns']);
    expect(d.bp.bindings[0]?.target).toBe('gun@3,-1');
    expect(d.editor.selection).toEqual(['gun@3,-1']);
    expect(d.steps()).toBe(1);
    // A part not yet selected is picked up and dragged in one go.
    d.send(down(0, 1), move(0, 2), up(0, 2));
    expect(d.editor.selection).toEqual(['propeller@0,2']);
    expect(d.steps()).toBe(2);
  });

  it('a blocked move says why and moves nothing', () => {
    const d = drive(drone()).send(down(2, 0), move(2, 1), up(2, 1));
    expect(cells(d.bp)).toEqual(cells(drone()));
    expect(d.refused).toBe('Blocked: gun@2,0 would land on core@2,1 at (2, 1). Nothing moved.');
    expect(d.editor.selection).toEqual(['gun@2,0']);
    expect(d.steps()).toBe(0);
    // Esc in the middle of a move calls it off and keeps the selection.
    d.send(down(2, 0), move(2, -3), { type: 'escape' }, up(2, -3));
    expect(cells(d.bp)).toEqual(cells(drone()));
    expect(d.editor.selection).toEqual(['gun@2,0']);
  });

  it('arrow keys nudge the selection one cell, one undo step each, and a blocked nudge says why', () => {
    const d = drive(drone()).send(...click(2, 0), { type: 'nudge', dx: 0, dy: -1 }, { type: 'nudge', dx: 1, dy: 0 });
    expect(d.bp.parts.find((p) => p.part === 'gun')).toMatchObject({ x: 3, y: -1 });
    expect(d.editor.selection).toEqual(['gun@3,-1']);
    expect(d.steps()).toBe(2);
    d.send({ type: 'nudge', dx: 0, dy: 1 }, { type: 'nudge', dx: 0, dy: 1 });
    expect(d.refused).toContain('would land on frame@3,1');
    expect(d.steps()).toBe(3);
    // With something in hand the arrows are not a nudge.
    const held = drive(drone()).send(...click(2, 0), { type: 'hold', part: 'frame' }, { type: 'nudge', dx: 1, dy: 0 });
    expect(cells(held.bp)).toEqual(cells(drone()));
  });

  it('R turns the selection and Delete removes it', () => {
    const d = drive(drone()).send(...click(2, 0), { type: 'rotate', dir: 1 });
    expect(d.bp.parts.find((p) => p.part === 'gun')?.rot).toBe(0);
    d.send({ type: 'deleteSelection' });
    expect(d.bp.parts.some((p) => p.part === 'gun')).toBe(false);
    expect(d.editor.selection).toEqual([]);
    expect(d.steps()).toBe(2);
  });
});

describe('copies carry everything', () => {
  it('Alt+click holds a copy of that very part: type, turn, groups, settings', () => {
    const d = drive(drone()).send({ type: 'hold', part: 'frame' }, ...click(2, 0, { alt: true }));
    expect(d.editor.held).toBeUndefined();
    expect(d.editor.copy?.stamp.parts).toHaveLength(1);
    d.send(...click(1, 0));
    const copy = d.bp.parts.find((p) => p.id === 'gun@1,0');
    expect(copy).toMatchObject({ part: 'gun', rot: 270, auto: false });
    expect(tagsOf(d.bp, 'gun@1,0')).toEqual(['guns']);
    // It stays in the hand, a drag paints more, each drag one step.
    d.send(...drag([3, 0], [4, 0]));
    expect(d.bp.parts.filter((p) => p.part === 'gun' && p.tags.includes('guns'))).toHaveLength(4);
    expect(d.steps()).toBe(2);
    // On a taken cell a copy is refused too.
    d.send(...click(2, 1));
    expect(d.refused).toBe('That cell is taken by a core. A copy lands only on empty cells.');
  });

  it('a plain tile from the drawer is blank', () => {
    const d = drive(drone()).send({ type: 'hold', part: 'gun' }, ...click(1, 0));
    expect(d.bp.parts.find((p) => p.id === 'gun@1,0')).toEqual({ id: 'gun@1,0', part: 'gun', x: 1, y: 0, rot: 0, tags: ['gun@1,0'] });
  });

  it('Cmd+D puts a copy of the selection in the hand; a click places all of it or none, as one step', () => {
    const d = drive(drone()).send(down(-1, 2), move(1, 1), up(1, 1), { type: 'move', cell: { x: 0, y: 1 } }, { type: 'duplicate' });
    expect(d.editor.selection).toEqual([]);
    expect(d.editor.copy?.stamp.parts.map((p) => `${p.part}@${p.x},${p.y}`)).toEqual(['propeller@0,0', 'frame@1,0']);
    // Over the robot: refused whole.
    d.send(...click(1, 1));
    expect(d.refused).toBe('The copy would land on 2 parts. It needs empty cells.');
    expect(d.bp.parts).toHaveLength(6);
    d.send(...click(0, 3));
    expect(cells(d.bp).slice(6)).toEqual(['propeller@0,3:0', 'frame@1,3:0']);
    expect(tagsOf(d.bp, 'propeller@0,3')).toEqual(['lprop', 'props']);
    expect(d.steps()).toBe(1);
    // R turns the held copy as one piece.
    d.send({ type: 'rotate', dir: 1 }, ...click(6, 3));
    expect(cells(d.bp).slice(8)).toEqual(['propeller@6,3:90', 'frame@6,4:90']);
    expect(d.steps()).toBe(2);
  });
});

describe('mirror: both halves land or neither', () => {
  const mirrored = (b: Blueprint = drone()) => drive(b).send({ type: 'toggleMirror' });

  it('a place lands on both sides, and is refused whole when one side is taken', () => {
    const d = mirrored().send({ type: 'hold', part: 'frame' }, ...click(1, 0));
    expect(cells(d.bp).slice(6)).toEqual(['frame@1,0:0', 'frame@3,0:0']);
    expect(d.steps()).toBe(1);
    // (0, 0) is free, its mirror image (4, 0) is not.
    const lop = mirrored({ ...drone(), parts: [...drone().parts, { id: 'frame@4,0', part: 'frame', x: 4, y: 0, rot: 0, tags: ['frame@4,0'] }] });
    lop.send({ type: 'hold', part: 'wheel' }, ...click(0, 0));
    expect(lop.refused).toBe('The mirrored cell is taken by a frame. Hold Shift to swap it for the wheel.');
    expect(lop.bp.parts).toHaveLength(7);
    expect(lop.steps()).toBe(0);
  });

  it('a Shift swap swaps both sides, or neither', () => {
    const d = mirrored().send({ type: 'hold', part: 'thruster' }, ...click(0, 1, { shift: true }));
    expect(d.bp.parts.filter((p) => p.part === 'thruster').map((p) => p.id)).toEqual(['thruster@0,1', 'thruster@4,1']);
    expect(tagsOf(d.bp, 'thruster@4,1')).toEqual(['rprop', 'props']);
    expect(d.steps()).toBe(1);
    // A laser is two cells tall: on the left it has room (the frame above was cleared), on the right it would cover two parts.
    const b = bp({ grid: ['.  F  .  F  F', 'F  F  C  F  F'] });
    const no = mirrored(b).send({ type: 'hold', part: 'laser' }, ...click(0, 0, { shift: true }));
    expect(cells(no.bp)).toEqual(cells(b));
    expect(no.refused).toContain('would cover 2 parts');
  });

  it('a move takes the mirror image the other way; blocked on either side, nothing moves', () => {
    const d = mirrored().send(down(0, 1), move(0, 2), up(0, 2));
    expect(d.bp.parts.filter((p) => p.part === 'propeller').map((p) => `${p.x},${p.y}`)).toEqual(['0,2', '4,2']);
    expect(d.steps()).toBe(1);
    d.send({ type: 'nudge', dx: -1, dy: 0 });
    expect(d.bp.parts.filter((p) => p.part === 'propeller').map((p) => `${p.x},${p.y}`)).toEqual(['-1,2', '5,2']);
    expect(tagsOf(d.bp, 'propeller@5,2')).toEqual(['rprop', 'props']);
    // Something in the way of the mirror image only.
    const blocked = mirrored({ ...drone(), parts: [...drone().parts, { id: 'frame@5,1', part: 'frame', x: 5, y: 1, rot: 0, tags: ['frame@5,1'] }] });
    blocked.send(...click(0, 1), { type: 'nudge', dx: -1, dy: 0 });
    expect(blocked.refused).toBe('Blocked: propeller@4,1 would land on frame@5,1 at (5, 1). Nothing moved.');
    expect(blocked.bp.parts.find((p) => p.id === 'propeller@0,1')).toBeDefined();
  });

  it('an erase clears both sides in one change', () => {
    const d = mirrored().send({ type: 'eraser' }, ...click(0, 1));
    expect(d.bp.parts.some((p) => p.part === 'propeller')).toBe(false);
    expect(d.steps()).toBe(1);
    d.history.undo();
    expect(d.bp.parts.filter((p) => p.part === 'propeller')).toHaveLength(2);
  });

  it('finds the mirror image of a part, and none for a part on the line', () => {
    const b = drone();
    const left = b.parts.find((p) => p.id === 'propeller@0,1');
    const core = b.parts.find((p) => p.id === 'core@2,1');
    if (!left || !core) throw new Error('no parts');
    expect(mirrorTwin(b, reg, left, 4)?.id).toBe('propeller@4,1');
    expect(mirrorTwin(b, reg, core, 4)).toBeUndefined();
  });
});

describe('the offer to a blank part placed among grouped ones', () => {
  it('offers the group its neighbours of the same type all share, for everything one drag placed', () => {
    const b = bp({ grid: ['g  g  .  .  C'], legend: { g: { part: 'gun', tags: ['guns', 'left'] } } });
    const d = drive(b).send({ type: 'hold', part: 'gun' }, ...drag([2, 0], [3, 0]));
    const placed = d.fx.flatMap((f) => f.placed ?? []);
    expect(placed).toEqual(['gun@2,0', 'gun@3,0']);
    expect(groupOffers(d.bp, reg, placed)).toEqual([
      { tag: 'guns', ids: ['gun@2,0', 'gun@3,0'] },
      { tag: 'left', ids: ['gun@2,0', 'gun@3,0'] },
    ]);
  });

  it('offers nothing when the neighbours share no group, are another type, or there are none', () => {
    const b = bp({ grid: ['a  .  b  F  .  C'], legend: { a: { part: 'gun', tags: ['one'] }, b: { part: 'gun', tags: ['two'] } } });
    const between = drive(b).send({ type: 'hold', part: 'gun' }, ...click(1, 0));
    expect(groupOffers(between.bp, reg, ['gun@1,0'])).toEqual([]);
    const byFrame = drive(b).send({ type: 'hold', part: 'gun' }, ...click(4, 0));
    expect(groupOffers(byFrame.bp, reg, ['gun@4,0'])).toEqual([]);
    expect(groupOffers(b, reg, [])).toEqual([]);
    // A copy is not blank: nothing is listed as placed for it.
    const copy = drive(b).send(...click(0, 0, { alt: true }), ...click(0, 1));
    expect(copy.fx.flatMap((f) => f.placed ?? [])).toEqual([]);
  });
});

describe('Swap to', () => {
  it('keeps the type name as a group when a script or a key drove the part by its type, and reports what will not work', () => {
    const b = bp({
      grid: ['T^ C  T^'],
      bindings: [{ key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 }],
      scripts: [{ id: 'fly', source: "function tick() {\n  set('thruster', 'throttle', 1);\n  for (const p of parts) if (p.type === 'thruster') log(p.id);\n}" }],
    });
    const r = swapParts(b, reg, ['thruster@0,0', 'thruster@2,0'], 'swivelthruster');
    if (!r.ok) throw new Error(r.error);
    expect(r.bp.parts.map((p) => p.id)).toEqual(['swivelthruster@0,0', 'core@1,0', 'swivelthruster@2,0']);
    expect(tagsOf(r.bp, 'swivelthruster@0,0')).toEqual(['thruster']);
    expect([...r.ids]).toEqual([['thruster@0,0', 'swivelthruster@0,0'], ['thruster@2,0', 'swivelthruster@2,0']]);
    // The script still reaches both.
    expect(showScript(r.bp, reg, undefined, 'fly')?.reached).toEqual(['swivelthruster@0,0', 'swivelthruster@2,0']);
    const note = editNote(b, r.bp, reg, { swaps: r.swaps, renames: r.ids });
    expect(note?.lines.map((l) => l.text)).toEqual([
      'Swapped 2 thrusters for swiveling thrusters.',
      'Kept: place and turn.',
      "They still answer to 'thruster' (as a group now), so the W key and fly.js still reach them.",
      "fly.js tests for the type 'thruster' in its own code (line 3). A swiveling thruster is not one, so it is skipped there. Only an edit to the script changes that.",
    ]);
    expect(note?.lines[3]?.bad).toBe(true);
  });

  it('says which input the new part lacks, and refuses whole when one does not fit', () => {
    const b = bp({ grid: ['T^ C  F', 'F  F  F'], bindings: [{ key: 'w', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 }] });
    const r = swapParts(b, reg, ['thruster@0,1'], 'gun');
    if (!r.ok) throw new Error(r.error);
    const lines = editNote(b, r.bp, reg, { swaps: r.swaps, renames: r.ids })?.lines ?? [];
    expect(lines.find((l) => l.bad)?.text).toBe("The W key writes 'throttle', which a gun does not have. That does nothing now.");
    // A laser needs the cell above: the frame at (2, 1) has one, the frame at (0, 0) has the thruster over it.
    const no = swapParts(b, reg, ['frame@2,1', 'frame@0,0'], 'laser');
    expect(no).toEqual({ ok: false, error: 'A laser does not fit in place of frame@0,0: it would cover thruster@0,1 at (0, 1).' });
  });
});

describe('the notice after an edit', () => {
  it('names what drove a removed part, and the names that reach nothing now', () => {
    const b = drone();
    const d = drive(b).send(...click(2, 0), { type: 'deleteSelection' });
    expect(editNote(b, d.bp, reg, {})?.lines).toEqual([
      { text: 'Removed 1 gun. The F key and hover.js drove it.' },
      { text: "Nothing answers to 'guns' any more (hover.js, line 1).", bad: true },
    ]);
  });

  it('says nothing for a part nothing drove, or for a plain place', () => {
    const b = drone();
    const d = drive(b).send(...click(1, 1), { type: 'deleteSelection' });
    expect(editNote(b, d.bp, reg, {})).toBeUndefined();
    const placed = drive(b).send({ type: 'hold', part: 'frame' }, ...click(0, 0));
    expect(editNote(b, placed.bp, reg, placed.fx[0] ?? {})).toBeUndefined();
  });

  it('says when a script picks parts in its own code and the removed part fits a name it builds', () => {
    const b = bp({
      grid: ['g  t  C'],
      legend: { g: { part: 'gun', tags: ['turret1', 'turret1.gun'] }, t: { part: 'rotator', tags: ['turret1', 'turret1.rot'] } },
      scripts: [{ id: 'turrets', source: "function tick() { for (const n of names()) set(n + '.gun', 'fire', 1); }" }],
    });
    const d = drive(b).send(...click(0, 0), { type: 'deleteSelection' });
    expect(editNote(b, d.bp, reg, {})?.lines).toEqual([{ text: 'Removed 1 gun. turrets.js may have driven it: it picks parts in its own code.' }]);
  });

  it('after a move, names the scripts that still spell the old id', () => {
    const b = bp({ grid: ['T^ C'], scripts: [{ id: 'burn', source: "function tick() {\n  set('thruster@0,0', 'throttle', 1);\n}" }] });
    const d = drive(b).send(...click(0, 0), { type: 'nudge', dx: 0, dy: 1 });
    expect(editNote(b, d.bp, reg, d.fx[0] ?? {})?.lines.map((l) => l.text)).toEqual([
      'Moved 1 part. Keys follow a moved part. Script code is not rewritten:',
      "burn.js spells 'thruster@0,0' (line 2). That part is now 'thruster@0,1'.",
    ]);
    // A move nothing spelled out says nothing.
    const quiet = drive(drone()).send(...click(2, 0), { type: 'nudge', dx: 0, dy: -1 });
    expect(editNote(drone(), quiet.bp, reg, quiet.fx[0] ?? {})).toBeUndefined();
  });
});

describe('what a script drives', () => {
  it('lists the parts a script reaches, by name, and the parts of the same kind it does not', () => {
    const b = { ...drone() };
    const d = drive(b).send({ type: 'hold', part: 'propeller' }, ...click(0, 2), ...click(4, 2));
    const v = showScript(d.bp, reg, undefined, 'hover');
    expect(v?.reached).toEqual(['propeller@0,1', 'propeller@4,1', 'gun@2,0']);
    expect(v?.names).toEqual([
      { name: 'lprop', parts: 1, dead: false, spare: false },
      { name: 'rprop', parts: 1, dead: false, spare: false },
      { name: 'guns', parts: 1, dead: false, spare: false },
    ]);
    expect(v?.buildsTargets).toBe(false);
    expect(v?.undriven.map((u) => [u.part, u.groups.map((g) => g.name)])).toEqual([
      ['propeller@0,2', ['lprop', 'rprop']],
      ['propeller@4,2', ['lprop', 'rprop']],
    ]);
    expect(showScript(d.bp, reg, undefined, 'nope')).toBeUndefined();
  });

  it('for a script that builds its names in code, says so, lists no undriven parts, and gives the parts its names fit', () => {
    const b = bp({
      grid: ['g  t  C  G'],
      legend: { g: { part: 'gun', tags: ['turret1', 'turret1.gun'] }, t: { part: 'rotator', tags: ['turret1', 'turret1.rot'] } },
      scripts: [{ id: 'turrets', source: "function tick() { for (const n of names()) { set(n + '.gun', 'fire', 1); set(n + '.rot', 'turn', 0); } }" }],
    });
    const v = showScript(b, reg, undefined, 'turrets');
    expect(v).toMatchObject({ reached: [], fits: ['gun@0,0', 'rotator@1,0'], undriven: [], buildsTargets: true });
  });

  it("reads another core's script under that core's scope", () => {
    const b = bp({
      grid: ['C  F  c  t'],
      legend: { c: { part: 'core', tags: ['m1'] }, t: { part: 'thruster', tags: ['m1', 'm1.burn'] } },
      cores: { 'core@2,0': { scope: 'm1', scripts: [{ id: 'guide', source: "function tick() { set('burn', 'throttle', 1); }" }] } },
    });
    expect(showScript(b, reg, 'core@2,0', 'guide')?.reached).toEqual(['thruster@3,0']);
    expect(showScript(b, reg, undefined, 'guide')).toBeUndefined();
  });

  it('says what drives each input of a part: your keys and the scripts, by the name they use', () => {
    const p = partInputs(drone(), reg, 'gun@2,0');
    expect(p.inputs.get('fire')).toEqual([
      { kind: 'key', name: 'f', via: 'guns' },
      { kind: 'script', name: 'hover', via: 'guns', line: 1 },
    ]);
    expect(p.mayDrive).toEqual([]);
    expect(partInputs(drone(), reg, 'frame@1,1').inputs.size).toBe(0);
  });
});

describe('dead names in Problems, and their fix', () => {
  const source = "// drives the guns\nfunction tick() {\n  set('gunz', 'fire', 1); set(\"gunz\", 'fire', 0);\n  log('gunz');\n}";
  const broken = (): Blueprint => ({ ...drone(), scripts: [{ id: 'aim', enabled: true, params: {}, source }] });

  it('lists a name that reaches nothing, with the script, the line and the real names, and the fix when one is close', () => {
    // The two sets on line 3 read the same, so they are one problem (and one fix, for both places).
    const problems = scriptProblems(broken(), reg);
    expect(problems).toHaveLength(1);
    const first = problems[0];
    expect(first).toMatchObject({ code: 'SCRIPT_TARGET', line: 3, open: { id: 'aim' } });
    expect(first?.message).toContain("script 'aim' line 3: set('gunz', ...) reaches nothing");
    expect(first?.message).toContain('tags here: guns');
    expect(first?.fix).toMatchObject({ from: 'gunz', to: 'guns', before: "set('gunz', 'fire', 1); set(\"gunz\", 'fire', 0);" });
    expect(first?.fix?.spots).toHaveLength(2);
    expect(scriptProblems(drone(), reg)).toEqual([]);
  });

  it('the fix rewrites exactly that quoted name at exactly that place, and nothing else', () => {
    const b = broken();
    const fix = scriptProblems(b, reg)[0]?.fix;
    if (!fix) throw new Error('no fix');
    const fixed = applyNameFix(b, reg, fix);
    const out = fixed.scripts[0]?.source;
    // Both sets on line 3 said the same thing, so both are in the one fix; the log('gunz') on line 4 is not a target.
    expect(out).toBe("// drives the guns\nfunction tick() {\n  set('guns', 'fire', 1); set(\"guns\", 'fire', 0);\n  log('gunz');\n}");
    expect(scriptProblems(fixed, reg)).toEqual([]);
    // Everything else about the robot is the same object.
    expect(fixed.parts).toBe(b.parts);
    // A script that changed since does not read the old name there: nothing is rewritten.
    const moved: Blueprint = { ...b, scripts: [{ id: 'aim', enabled: true, params: {}, source: `\n${source}` }] };
    expect(applyNameFix(moved, reg, fix)).toBe(moved);
  });

  it('copies of one script are one problem, and the fix reaches every copy', () => {
    const guide = "function tick() { set('burnn', 'throttle', 1); }";
    const b = bp({
      grid: ['C  a  x  b  y'],
      legend: { a: { part: 'core', tags: ['m1'] }, x: { part: 'thruster', tags: ['m1', 'm1.burn'] }, b: { part: 'core', tags: ['m2'] }, y: { part: 'thruster', tags: ['m2', 'm2.burn'] } },
      cores: { 'core@1,0': { scope: 'm1', scripts: [{ id: 'guide', source: guide }] }, 'core@3,0': { scope: 'm2', scripts: [{ id: 'guide', source: guide }] } },
    });
    const problems = scriptProblems(b, reg);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.open).toEqual({ id: 'guide', core: 'core@1,0' });
    expect(problems[0]?.fix?.spots).toHaveLength(2);
    const fixed = applyNameFix(b, reg, problems[0]?.fix ?? { from: '', to: '', before: '', after: '', spots: [] });
    expect(fixed.cores?.map((c) => c.scripts[0]?.source)).toEqual(["function tick() { set('burn', 'throttle', 1); }", "function tick() { set('burn', 'throttle', 1); }"]);
    expect(scriptProblems(fixed, reg)).toEqual([]);
  });
});
