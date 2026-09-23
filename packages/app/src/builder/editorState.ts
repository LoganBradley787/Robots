import {
  erasePartAt,
  isCore,
  mirrorRotation,
  removeParts,
  setPartRotation,
  mirrorX,
  partAt,
  placePart,
  type Blueprint,
  type PartRegistry,
  type Rotation,
} from '@robots/sim-core';

export interface Cell {
  x: number;
  y: number;
}

export interface EditorState {
  /** The part being painted, if any. */
  held?: { part: string; rot: Rotation };
  /** The eraser tool (`E`): left-click or drag erases. Never together with `held`. */
  eraser?: true;
  /** The part menu (right-click, `11`) is open on these parts. */
  menu?: { ids: string[] };
  hover?: Cell;
  gesture?: { kind: 'paint' | 'erase' | 'select'; start: Cell; last: Cell };
  /** Shift was held when the current gesture started. */
  gestureShift?: boolean;
  selection: string[];
  /** `axisSet` is false until mirror mode is first turned on, which puts the axis on the core's column. */
  mirror: { on: boolean; axisHalfCells: number; axisSet: boolean };
}

export type EditorEvent =
  | { type: 'pick'; index: number }
  | { type: 'hold'; part: string }
  | { type: 'eraser' }
  | { type: 'closeMenu' }
  | { type: 'rotate'; dir: 1 | -1 }
  | { type: 'escape' }
  | { type: 'down'; cell: Cell; button: 'left' | 'right'; shift: boolean }
  | { type: 'move'; cell: Cell }
  | { type: 'up'; cell: Cell }
  | { type: 'toggleMirror' }
  | { type: 'setAxis'; axisHalfCells: number }
  | { type: 'shiftAxis'; delta: number }
  | { type: 'deleteSelection' }
  | { type: 'endGesture' };

export interface ReduceResult {
  editor: EditorState;
  bp: Blueprint;
  /** Tells the caller to open or close a history gesture. */
  gesture?: 'begin' | 'end';
}

export function initialEditor(): EditorState {
  return { selection: [], mirror: { on: false, axisHalfCells: 0, axisSet: false } };
}

const ROTS: readonly Rotation[] = [0, 90, 180, 270];

function rotateBy(rot: Rotation, dir: 1 | -1): Rotation {
  return ROTS[(ROTS.indexOf(rot) + (dir === 1 ? 1 : 3)) % 4] ?? 0;
}

/** Cells on the line from a to b, excluding a, including b (Bresenham), so fast drags leave no gaps. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    out.push({ x, y });
  }
  return out;
}

/** A click selects the part under it; a drag selects every part whose cell is in the box. Shift adds or toggles. */
function selectAfter(editor: EditorState, bp: Blueprint, registry: PartRegistry, a: Cell, b: Cell): string[] {
  const shift = editor.gesture?.kind === 'select' && editor.gestureShift === true;
  if (a.x === b.x && a.y === b.y) {
    const hit = partAt(bp, registry, a.x, a.y);
    if (!shift) return hit ? [hit.id] : [];
    if (!hit) return editor.selection;
    return editor.selection.includes(hit.id) ? editor.selection.filter((id) => id !== hit.id) : [...editor.selection, hit.id];
  }
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inBox = bp.parts.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id);
  return shift ? [...editor.selection, ...inBox.filter((id) => !editor.selection.includes(id))] : inBox;
}

function applyAt(editor: EditorState, bp: Blueprint, kind: 'paint' | 'erase', c: Cell, registry: PartRegistry): Blueprint {
  const mx = mirrorX(c.x, editor.mirror.axisHalfCells);
  const both = editor.mirror.on && mx !== c.x;
  if (kind === 'erase') {
    const once = erasePartAt(bp, registry, c.x, c.y);
    return both ? erasePartAt(once, registry, mx, c.y) : once;
  }
  const held = editor.held;
  if (!held) return bp;
  const once = placePart(bp, registry, held.part, c.x, c.y, held.rot);
  return both ? placePart(once, registry, held.part, mx, c.y, mirrorRotation(held.rot)) : once;
}

/** Pure builder input handling. `partIds` is the palette order (number keys 1 to 8). */
export function reduce(editor: EditorState, bp: Blueprint, e: EditorEvent, registry: PartRegistry, partIds: readonly string[]): ReduceResult {
  switch (e.type) {
    case 'pick': {
      const part = partIds[e.index];
      return part === undefined ? { editor, bp } : reduce(editor, bp, { type: 'hold', part }, registry, partIds);
    }
    case 'hold': {
      const rot = editor.held?.part === e.part ? editor.held.rot : 0;
      const { eraser: _eraser, menu: _menu, ...rest } = editor;
      return { editor: { ...rest, held: { part: e.part, rot }, selection: [] }, bp };
    }
    case 'eraser': {
      const { held: _held, menu: _menu, eraser, ...rest } = editor;
      return { editor: eraser ? rest : { ...rest, eraser: true, selection: [] }, bp };
    }
    case 'closeMenu': {
      const { menu: _menu, ...rest } = editor;
      return { editor: rest, bp };
    }
    case 'rotate': {
      // With the part menu open, rotation is for the parts it is on, not the part in your hand.
      if (editor.held && !editor.menu) return { editor: { ...editor, held: { ...editor.held, rot: rotateBy(editor.held.rot, e.dir) } }, bp };
      let out = bp;
      for (const id of editor.selection) {
        const p = out.parts.find((q) => q.id === id);
        if (p) out = setPartRotation(out, registry, id, rotateBy(p.rot, e.dir));
      }
      return { editor, bp: out };
    }
    case 'deleteSelection': {
      if (editor.selection.length === 0) return { editor, bp };
      const { menu: _menu, ...rest } = editor;
      return { editor: { ...rest, selection: [] }, bp: removeParts(bp, editor.selection) };
    }
    case 'escape': {
      const { held: _held, eraser: _eraser, menu: _menu, gesture: g, gestureShift: _shift, ...rest } = editor;
      return { editor: { ...rest, selection: [] }, bp, ...(g && g.kind !== 'select' ? { gesture: 'end' as const } : {}) };
    }
    case 'endGesture': {
      const { gesture: g, gestureShift: _shift, ...rest } = editor;
      return { editor: rest, bp, ...(g && g.kind !== 'select' ? { gesture: 'end' as const } : {}) };
    }
    case 'toggleMirror': {
      const m = editor.mirror;
      if (!m.on && !m.axisSet) {
        const core = bp.parts.find((p) => isCore(p, registry));
        return { editor: { ...editor, mirror: { on: true, axisHalfCells: 2 * (core?.x ?? 0), axisSet: true } }, bp };
      }
      return { editor: { ...editor, mirror: { ...m, on: !m.on } }, bp };
    }
    case 'setAxis':
      return { editor: { ...editor, mirror: { ...editor.mirror, axisHalfCells: e.axisHalfCells, axisSet: true } }, bp };
    case 'shiftAxis':
      return { editor: { ...editor, mirror: { ...editor.mirror, axisHalfCells: editor.mirror.axisHalfCells + e.delta, axisSet: true } }, bp };
    case 'down': {
      if (editor.gesture) return { editor, bp };
      const { menu: _menu, ...closed } = editor;
      if (e.button === 'right') {
        // Right-click opens the part menu: on the selection when the part is in it, else on just that part.
        const hit = partAt(bp, registry, e.cell.x, e.cell.y);
        if (!hit) return { editor: closed, bp };
        const ids = editor.selection.includes(hit.id) ? editor.selection : [hit.id];
        return { editor: { ...closed, selection: ids, menu: { ids } }, bp };
      }
      const kind = editor.eraser ? 'erase' : editor.held ? 'paint' : 'select';
      const next = {
        ...closed,
        hover: e.cell,
        gesture: { kind, start: e.cell, last: e.cell },
        gestureShift: e.shift,
        // Painting or erasing ends a selection, so a stale id never lands on a new part in the same cell.
        selection: kind === 'select' ? editor.selection : [],
      } satisfies EditorState;
      if (kind === 'select') return { editor: next, bp };
      return { editor: next, bp: applyAt(editor, bp, kind, e.cell, registry), gesture: 'begin' };
    }
    case 'move': {
      const g = editor.gesture;
      if (!g || g.kind === 'select') return { editor: { ...editor, hover: e.cell, ...(g ? { gesture: { ...g, last: e.cell } } : {}) }, bp };
      if (g.last.x === e.cell.x && g.last.y === e.cell.y) return { editor: { ...editor, hover: e.cell }, bp };
      let out = bp;
      for (const c of lineCells(g.last, e.cell)) out = applyAt(editor, out, g.kind, c, registry);
      return { editor: { ...editor, hover: e.cell, gesture: { ...g, last: e.cell } }, bp: out };
    }
    case 'up': {
      const g = editor.gesture;
      if (!g) return { editor, bp };
      const { gesture: _gesture, gestureShift: _shift, ...rest } = editor;
      if (g.kind === 'select') return { editor: { ...rest, hover: e.cell, selection: selectAfter(editor, bp, registry, g.start, e.cell) }, bp };
      const moved = reduce(editor, bp, { type: 'move', cell: e.cell }, registry, partIds);
      return { editor: { ...rest, hover: e.cell }, bp: moved.bp, gesture: 'end' };
    }
  }
}
