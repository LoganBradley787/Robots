import { describe, expect, it } from 'vitest';
import { blankBlueprint, defaultRegistry, type Blueprint } from '@robots/sim-core';
import { History } from '../src/builder/history';
import { initialEditor, reduce, type EditorEvent, type EditorState } from '../src/builder/editorState';

const reg = defaultRegistry();
const PARTS = reg.ids();

function run(events: EditorEvent[], bp: Blueprint = blankBlueprint('t'), editor: EditorState = initialEditor()) {
  let state = { editor, bp };
  const gestures: string[] = [];
  for (const e of events) {
    const r = reduce(state.editor, state.bp, e, reg, PARTS);
    state = { editor: r.editor, bp: r.bp };
    if (r.gesture) gestures.push(r.gesture);
  }
  return { ...state, gestures };
}

const cellsOf = (bp: Blueprint): string[] => bp.parts.map((p) => `${p.part}@${p.x},${p.y}:${p.rot}`);

describe('History', () => {
  it('commits, undoes, and redoes', () => {
    const a = blankBlueprint('a');
    const b = { ...a, name: 'b' };
    const c = { ...a, name: 'c' };
    const h = new History(a);
    h.commit(b);
    h.commit(c);
    expect(h.undo()?.name).toBe('b');
    expect(h.undo()?.name).toBe('a');
    expect(h.undo()).toBeUndefined();
    expect(h.redo()?.name).toBe('b');
    h.commit({ ...a, name: 'd' });
    expect(h.canRedo).toBe(false);
  });

  it('ignores commits of the same object', () => {
    const a = blankBlueprint('a');
    const h = new History(a);
    h.commit(a);
    expect(h.canUndo).toBe(false);
  });

  it('coalesces a gesture into one entry', () => {
    const a = blankBlueprint('a');
    const h = new History(a);
    h.beginGesture();
    h.commit({ ...a, name: '1' });
    h.commit({ ...a, name: '2' });
    h.commit({ ...a, name: '3' });
    h.endGesture();
    expect(h.present.name).toBe('3');
    expect(h.undo()?.name).toBe('a');
  });

  it('caps its length', () => {
    const h = new History(blankBlueprint('0'), 3);
    for (let i = 1; i <= 5; i++) h.commit(blankBlueprint(String(i)));
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(3);
  });
});

describe('editor reducer', () => {
  it('number keys pick parts in registry order', () => {
    const { editor } = run([{ type: 'pick', index: 1 }]);
    expect(editor.held).toEqual({ part: 'frame', rot: 0 });
  });

  it('a left drag paints every cell it passes, even when the pointer jumps', () => {
    const r = run([
      { type: 'pick', index: 1 },
      { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false },
      { type: 'move', cell: { x: 3, y: 0 } },
      { type: 'up', cell: { x: 3, y: 0 } },
    ]);
    expect(cellsOf(r.bp)).toEqual(['frame@0,0:0', 'frame@1,0:0', 'frame@2,0:0', 'frame@3,0:0']);
    expect(r.gestures).toEqual(['begin', 'end']);
  });

  it('a right drag erases', () => {
    const painted = run([
      { type: 'pick', index: 1 },
      { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false },
      { type: 'move', cell: { x: 2, y: 0 } },
      { type: 'up', cell: { x: 2, y: 0 } },
    ]);
    const r = run(
      [
        { type: 'down', cell: { x: 0, y: 0 }, button: 'right', shift: false },
        { type: 'move', cell: { x: 1, y: 0 } },
        { type: 'up', cell: { x: 1, y: 0 } },
      ],
      painted.bp,
      painted.editor,
    );
    expect(cellsOf(r.bp)).toEqual(['frame@2,0:0']);
  });

  it('rotate cycles the held part and escape drops it', () => {
    const r = run([{ type: 'pick', index: 4 }, { type: 'rotate', dir: 1 }, { type: 'rotate', dir: 1 }]);
    expect(r.editor.held).toEqual({ part: 'thruster', rot: 180 });
    const back = run([{ type: 'rotate', dir: -1 }, { type: 'rotate', dir: -1 }, { type: 'rotate', dir: -1 }], r.bp, r.editor);
    expect(back.editor.held?.rot).toBe(270);
    expect(run([{ type: 'escape' }], r.bp, r.editor).editor.held).toBeUndefined();
  });

  it('mirror mode paints the mirrored cell with the mirrored rotation', () => {
    const r = run([
      { type: 'pick', index: 4 },
      { type: 'rotate', dir: -1 }, // thruster rot 270: pushes right
      { type: 'toggleMirror' },
      { type: 'setAxis', axisHalfCells: 4 },
      { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false },
      { type: 'up', cell: { x: 0, y: 0 } },
    ]);
    expect(cellsOf(r.bp)).toEqual(['thruster@0,0:270', 'thruster@4,0:90']);
  });

  it('mirror mode on the axis places once', () => {
    const r = run([
      { type: 'pick', index: 0 },
      { type: 'toggleMirror' },
      { type: 'setAxis', axisHalfCells: 4 },
      { type: 'down', cell: { x: 2, y: 1 }, button: 'left', shift: false },
      { type: 'up', cell: { x: 2, y: 1 } },
    ]);
    expect(cellsOf(r.bp)).toEqual(['core@2,1:0']);
  });

  it('escape mid-drag closes the gesture', () => {
    const r = run([
      { type: 'pick', index: 1 },
      { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false },
      { type: 'move', cell: { x: 1, y: 0 } },
      { type: 'escape' },
    ]);
    expect(r.gestures).toEqual(['begin', 'end']);
    expect(r.editor.gesture).toBeUndefined();
  });

  it('endGesture closes a drag without dropping the held part', () => {
    const r = run([{ type: 'pick', index: 1 }, { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false }, { type: 'endGesture' }]);
    expect(r.gestures).toEqual(['begin', 'end']);
    expect(r.editor.held?.part).toBe('frame');
  });

  it('hover moves without editing', () => {
    const r = run([{ type: 'pick', index: 1 }, { type: 'move', cell: { x: 5, y: 5 } }]);
    expect(r.bp.parts).toEqual([]);
    expect(r.editor.hover).toEqual({ x: 5, y: 5 });
  });
});

describe('selection', () => {
  const car = (): Blueprint =>
    run([
      { type: 'pick', index: 1 },
      { type: 'down', cell: { x: 0, y: 1 }, button: 'left', shift: false },
      { type: 'move', cell: { x: 3, y: 1 } },
      { type: 'up', cell: { x: 3, y: 1 } },
      { type: 'pick', index: 0 },
      { type: 'down', cell: { x: 1, y: 1 }, button: 'left', shift: false },
      { type: 'up', cell: { x: 1, y: 1 } },
    ]).bp;

  it('a click with nothing held selects the part under it, shift toggles more', () => {
    const bp = car();
    const a = run([{ type: 'down', cell: { x: 0, y: 1 }, button: 'left', shift: false }, { type: 'up', cell: { x: 0, y: 1 } }], bp);
    expect(a.editor.selection).toEqual(['frame@0,1']);
    const b = run([{ type: 'down', cell: { x: 2, y: 1 }, button: 'left', shift: true }, { type: 'up', cell: { x: 2, y: 1 } }], bp, a.editor);
    expect(b.editor.selection).toEqual(['frame@0,1', 'frame@2,1']);
    const c = run([{ type: 'down', cell: { x: 0, y: 1 }, button: 'left', shift: true }, { type: 'up', cell: { x: 0, y: 1 } }], bp, b.editor);
    expect(c.editor.selection).toEqual(['frame@2,1']);
  });

  it('a drag with nothing held selects every part in the box', () => {
    const r = run(
      [
        { type: 'down', cell: { x: 1, y: 0 }, button: 'left', shift: false },
        { type: 'move', cell: { x: 2, y: 2 } },
        { type: 'up', cell: { x: 2, y: 2 } },
      ],
      car(),
    );
    expect(r.editor.selection).toEqual(['frame@2,1', 'core@1,1']);
    expect(r.gestures).toEqual([]);
  });

  it('delete removes the selection in one edit and clears it', () => {
    const bp = car();
    const r = run([{ type: 'down', cell: { x: 0, y: 1 }, button: 'left', shift: false }, { type: 'up', cell: { x: 0, y: 1 } }, { type: 'deleteSelection' }], bp);
    expect(r.bp.parts.map((p) => p.id)).toEqual(['frame@2,1', 'frame@3,1', 'core@1,1']);
    expect(r.editor.selection).toEqual([]);
  });

  it('rotate with nothing held rotates the selected parts in place', () => {
    const bp = run([{ type: 'pick', index: 4 }, { type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false }, { type: 'up', cell: { x: 0, y: 0 } }]).bp;
    const r = run([{ type: 'down', cell: { x: 0, y: 0 }, button: 'left', shift: false }, { type: 'up', cell: { x: 0, y: 0 } }, { type: 'rotate', dir: 1 }], bp);
    expect(r.bp.parts[0]?.rot).toBe(90);
  });

  it('turning mirror on the first time puts the axis on the core column', () => {
    const r = run([{ type: 'toggleMirror' }], car());
    expect(r.editor.mirror).toMatchObject({ on: true, axisHalfCells: 2 });
    const moved = run([{ type: 'shiftAxis', delta: 1 }, { type: 'toggleMirror' }, { type: 'toggleMirror' }], r.bp, r.editor);
    expect(moved.editor.mirror).toMatchObject({ on: true, axisHalfCells: 3 });
  });
});
