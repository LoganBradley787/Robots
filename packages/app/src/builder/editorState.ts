import {
  erasePartAt,
  mirrorRotation,
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
  hover?: Cell;
  gesture?: { kind: 'paint' | 'erase' | 'select'; start: Cell; last: Cell };
  selection: string[];
  mirror: { on: boolean; axisHalfCells: number };
}

export type EditorEvent =
  | { type: 'pick'; index: number }
  | { type: 'hold'; part: string }
  | { type: 'rotate'; dir: 1 | -1 }
  | { type: 'escape' }
  | { type: 'down'; cell: Cell; button: 'left' | 'right'; shift: boolean }
  | { type: 'move'; cell: Cell }
  | { type: 'up'; cell: Cell }
  | { type: 'toggleMirror' }
  | { type: 'setAxis'; axisHalfCells: number }
  | { type: 'shiftAxis'; delta: number };

export interface ReduceResult {
  editor: EditorState;
  bp: Blueprint;
  /** Tells the caller to open or close a history gesture. */
  gesture?: 'begin' | 'end';
}

export function initialEditor(): EditorState {
  return { selection: [], mirror: { on: false, axisHalfCells: 0 } };
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
      return { editor: { ...editor, held: { part: e.part, rot }, selection: [] }, bp };
    }
    case 'rotate':
      return editor.held ? { editor: { ...editor, held: { ...editor.held, rot: rotateBy(editor.held.rot, e.dir) } }, bp } : { editor, bp };
    case 'escape': {
      const { held: _held, gesture: _gesture, ...rest } = editor;
      return { editor: { ...rest, selection: [] }, bp };
    }
    case 'toggleMirror':
      return { editor: { ...editor, mirror: { ...editor.mirror, on: !editor.mirror.on } }, bp };
    case 'setAxis':
      return { editor: { ...editor, mirror: { ...editor.mirror, axisHalfCells: e.axisHalfCells } }, bp };
    case 'shiftAxis':
      return { editor: { ...editor, mirror: { ...editor.mirror, axisHalfCells: editor.mirror.axisHalfCells + e.delta } }, bp };
    case 'down': {
      if (editor.gesture) return { editor, bp };
      const kind = e.button === 'right' ? 'erase' : editor.held ? 'paint' : 'select';
      const next = { ...editor, hover: e.cell, gesture: { kind, start: e.cell, last: e.cell } } satisfies EditorState;
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
      const { gesture: _gesture, ...rest } = editor;
      if (g.kind === 'select') {
        const hit = partAt(bp, registry, e.cell.x, e.cell.y);
        return { editor: { ...rest, hover: e.cell, selection: hit ? [hit.id] : [] }, bp };
      }
      const moved = reduce(editor, bp, { type: 'move', cell: e.cell }, registry, partIds);
      return { editor: { ...rest, hover: e.cell }, bp: moved.bp, gesture: 'end' };
    }
  }
}
