import { isCore, partAt, removeParts, setPartRotations, stampOfParts, type Blueprint, type PartRegistry, type PlacedPart, type Rotation } from '@robots/sim-core';
import { cellsOfPart, copyOf, eraseAt, moveSelection, placeCopy, placeHeld, sentence, type Cell, type Fx, type HeldCopy, type PlaceOutcome } from './boardOps';
import { placeStamp, type Stamp } from './stamp';

export type { Cell } from './boardOps';

/**
 * One drag on the board (M16: no modes, so what a drag is depends only on what was in the hand and what was under the
 * cursor when it began).
 * - `paint`: the part (or the copy of one part) in hand lands on every empty cell passed; with `swap` (Shift) it takes
 *   the place of what is there.
 * - `erase`: the eraser removes every part passed.
 * - `box`: empty hand, started on an empty cell: selects what the box covers, on top of `keep` (Shift).
 * - `move`: empty hand, started on a selected part: the selection follows as outlines and lands on release.
 */
export type Gesture =
  | { kind: 'paint'; start: Cell; last: Cell; swap: boolean }
  | { kind: 'erase'; start: Cell; last: Cell }
  | { kind: 'box'; start: Cell; last: Cell; keep: string[] }
  | { kind: 'move'; start: Cell; last: Cell; ids: string[]; /** A press on one of several selected parts: let go without moving, it becomes the only one. */ narrowTo?: string };

export interface EditorState {
  /** A blank part from the drawer or the hotbar, in hand. At most one of `held`, `copy`, `stamp`, `eraser` is set. */
  held?: { part: string; rot: Rotation };
  /** A copy of parts in hand, with their groups and settings: Alt+click on a part, or Cmd+D on the selection. */
  copy?: HeldCopy;
  /** A saved blueprint held to place as a copy (M7). */
  stamp?: Stamp;
  /** The eraser (`E`): click or drag over parts removes them. */
  eraser?: true;
  hover?: Cell;
  gesture?: Gesture;
  selection: string[];
  /** `axisSet` is false until mirror mode is first turned on, which puts the axis on the core's column. */
  mirror: { on: boolean; axisHalfCells: number; axisSet: boolean };
}

export type EditorEvent =
  | { type: 'pick'; index: number }
  | { type: 'hold'; part: string }
  | { type: 'holdBlueprint'; name: string; bp: Blueprint }
  | { type: 'flip' }
  | { type: 'eraser' }
  | { type: 'rotate'; dir: 1 | -1 }
  | { type: 'escape' }
  | { type: 'down'; cell: Cell; button: 'left' | 'right'; shift: boolean; alt?: boolean }
  | { type: 'move'; cell: Cell }
  | { type: 'up'; cell: Cell }
  | { type: 'toggleMirror' }
  | { type: 'setAxis'; axisHalfCells: number }
  | { type: 'shiftAxis'; delta: number }
  | { type: 'deleteSelection' }
  /** Arrow keys: the selection moves one cell. */
  | { type: 'nudge'; dx: number; dy: number }
  /** Cmd+D: a copy of the selection, groups and settings and all, goes into the hand. */
  | { type: 'duplicate' }
  | { type: 'selectAll' }
  | { type: 'endGesture' };

export interface ReduceResult {
  editor: EditorState;
  bp: Blueprint;
  /** Tells the caller to open or close a history gesture. */
  gesture?: 'begin' | 'end';
  /** Why this event's edit did not happen, in words for the player. Shown at the cursor; not kept in the state. */
  refused?: string;
  /** What the edit did besides changing the blueprint: for the notice and the offer that follow it. */
  fx?: Fx;
  /** A right-click picked a part to look at: the inspector turns to its Part tab. */
  focus?: true;
}

export function initialEditor(): EditorState {
  return { selection: [], mirror: { on: false, axisHalfCells: 0, axisSet: false } };
}

/** Whether anything is in the hand: then clicks place (or erase), else they select. */
export function handFull(e: EditorState): boolean {
  return e.held !== undefined || e.copy !== undefined || e.stamp !== undefined || e.eraser === true;
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

/** Every part with a cell in the box from a to b, in part order. Any cell of a multi-cell part counts (review E4). */
function inBox(bp: Blueprint, registry: PartRegistry, a: Cell, b: Cell): string[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return bp.parts.filter((p) => cellsOfPart(p, registry).some((c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1)).map((p) => p.id);
}

/** What a box drag selects: what was kept (Shift), then what the box covers. A click on an empty cell covers nothing. */
function boxSelection(bp: Blueprint, registry: PartRegistry, g: Extract<Gesture, { kind: 'box' }>, to: Cell): string[] {
  if (g.start.x === to.x && g.start.y === to.y) return g.keep;
  const hit = inBox(bp, registry, g.start, to);
  return [...g.keep, ...hit.filter((id) => !g.keep.includes(id))];
}

function mergeFx(a: Fx | undefined, b: Fx | undefined): Fx | undefined {
  if (!a) return b;
  if (!b) return a;
  const renames = new Map(a.renames ?? []);
  for (const [from, to] of b.renames ?? []) renames.set(from, to);
  return { placed: [...(a.placed ?? []), ...(b.placed ?? [])], swaps: [...(a.swaps ?? []), ...(b.swaps ?? [])], renames, named: [...(a.named ?? []), ...(b.named ?? [])] };
}

/** The hand emptied: no part, no copy, no held robot, no eraser. */
function emptied(editor: EditorState): EditorState {
  const { held: _held, copy: _copy, stamp: _stamp, eraser: _eraser, ...rest } = editor;
  return rest;
}

/** What the hand does to one cell: place the part or the copy, or erase. */
function applyAt(editor: EditorState, bp: Blueprint, g: Extract<Gesture, { kind: 'paint' | 'erase' }>, c: Cell, registry: PartRegistry): PlaceOutcome {
  if (g.kind === 'erase') return { ok: true, bp: eraseAt(bp, registry, c, editor.mirror), fx: {} };
  if (editor.held) return placeHeld(bp, registry, editor.held, c, editor.mirror, g.swap);
  if (editor.copy) {
    const only = editor.copy.stamp.parts.length === 1 ? editor.copy.stamp.parts[0] : undefined;
    // Shift with a copy of one part swaps what is there for its type; the part there keeps its own groups.
    if (g.swap && only && partAt(bp, registry, c.x, c.y)) return placeHeld(bp, registry, { part: only.part, rot: ((only.rot + editor.copy.rot) % 360) as Rotation }, c, editor.mirror, true);
    return placeCopy(bp, registry, editor.copy, c, editor.mirror);
  }
  return { ok: true, bp, fx: {} };
}

/** Applies the hand along cells; a refused cell is skipped and the last reason kept. */
function applyAlong(editor: EditorState, bp: Blueprint, g: Extract<Gesture, { kind: 'paint' | 'erase' }>, cells: readonly Cell[], registry: PartRegistry): { bp: Blueprint; fx?: Fx; refused?: string } {
  let out = bp;
  let fx: Fx | undefined;
  let refused: string | undefined;
  for (const c of cells) {
    const r = applyAt(editor, out, g, c, registry);
    if (r.ok) {
      out = r.bp;
      fx = mergeFx(fx, r.fx);
    } else refused = r.error;
  }
  return { bp: out, ...(fx ? { fx } : {}), ...(refused !== undefined ? { refused } : {}) };
}

/**
 * Pure builder input handling (M16: one way of working, no modes). `partIds` is what the number keys pick, in order:
 * the hotbar. A name no part has picks nothing.
 */
export function reduce(editor: EditorState, bp: Blueprint, e: EditorEvent, registry: PartRegistry, partIds: readonly string[]): ReduceResult {
  switch (e.type) {
    case 'pick': {
      const part = partIds[e.index];
      return part === undefined || !registry.has(part) ? { editor, bp } : reduce(editor, bp, { type: 'hold', part }, registry, partIds);
    }
    case 'hold': {
      if (editor.gesture) return { editor, bp };
      const rot = editor.held?.part === e.part ? editor.held.rot : 0;
      return { editor: { ...emptied(editor), held: { part: e.part, rot }, selection: [] }, bp };
    }
    case 'holdBlueprint': {
      if (editor.gesture) return { editor, bp };
      return { editor: { ...emptied(editor), stamp: { name: e.name, bp: e.bp, rot: 0, flipped: false }, selection: [] }, bp };
    }
    case 'flip':
      if (editor.stamp) return { editor: { ...editor, stamp: { ...editor.stamp, flipped: !editor.stamp.flipped } }, bp };
      if (editor.copy) return { editor: { ...editor, copy: { ...editor.copy, flipped: !editor.copy.flipped } }, bp };
      return { editor, bp };
    case 'eraser': {
      if (editor.gesture) return { editor, bp };
      return { editor: editor.eraser ? emptied(editor) : { ...emptied(editor), eraser: true, selection: [] }, bp };
    }
    case 'rotate': {
      if (editor.held) return { editor: { ...editor, held: { ...editor.held, rot: rotateBy(editor.held.rot, e.dir) } }, bp };
      if (editor.copy) return { editor: { ...editor, copy: { ...editor.copy, rot: rotateBy(editor.copy.rot, e.dir) } }, bp };
      if (editor.stamp) return { editor: { ...editor, stamp: { ...editor.stamp, rot: rotateBy(editor.stamp.rot, e.dir) } }, bp };
      if (editor.gesture) return { editor, bp };
      // The selection turns as one change, or not at all when a turned part would land on another (review E1).
      const rots = new Map<string, Rotation>();
      for (const id of editor.selection) {
        const p = bp.parts.find((q) => q.id === id);
        if (p) rots.set(id, rotateBy(p.rot, e.dir));
      }
      const r = setPartRotations(bp, registry, rots);
      return r.ok ? { editor, bp: r.blueprint } : { editor, bp, refused: `Blocked: ${r.error}. Nothing turned.` };
    }
    case 'deleteSelection': {
      if (editor.selection.length === 0 || editor.gesture) return { editor, bp };
      return { editor: { ...editor, selection: [] }, bp: removeParts(bp, editor.selection, registry) };
    }
    case 'nudge': {
      if (editor.selection.length === 0 || editor.gesture || handFull(editor)) return { editor, bp };
      const r = moveSelection(bp, registry, editor.selection, e.dx, e.dy, editor.mirror);
      if (!r.ok) return { editor, bp, refused: r.error };
      return { editor: { ...editor, selection: r.selection }, bp: r.bp, fx: { renames: r.renames } };
    }
    case 'duplicate': {
      if (editor.gesture) return { editor, bp };
      const picked = bp.parts.filter((p) => editor.selection.includes(p.id));
      if (picked.length === 0) return { editor, bp };
      // Held by the part under the cursor when that is one of them, else by the first.
      const under = editor.hover ? partAt(bp, registry, editor.hover.x, editor.hover.y) : undefined;
      const anchor = under && editor.selection.includes(under.id) ? under : (picked[0] as PlacedPart);
      return { editor: { ...emptied(editor), copy: copyOf(bp, stampOfParts(bp, editor.selection, anchor.id), editor.selection), selection: [] }, bp };
    }
    case 'selectAll': {
      if (editor.gesture || handFull(editor)) return { editor, bp };
      return { editor: { ...editor, selection: bp.parts.map((p) => p.id) }, bp };
    }
    case 'escape': {
      const g = editor.gesture;
      if (g) {
        const { gesture: _gesture, ...rest } = editor;
        // A drag of the selection, or a box, is called off: nothing moves, nothing is put down.
        if (g.kind === 'move') return { editor: rest, bp };
        if (g.kind === 'box') return { editor: { ...rest, selection: g.keep }, bp };
        return { editor: emptied(rest), bp, gesture: 'end' };
      }
      // First what is in the hand; with an empty hand, the selection.
      if (handFull(editor)) return { editor: emptied(editor), bp };
      return { editor: { ...editor, selection: [] }, bp };
    }
    case 'endGesture': {
      const { gesture: g, ...rest } = editor;
      return { editor: rest, bp, ...(g && (g.kind === 'paint' || g.kind === 'erase') ? { gesture: 'end' as const } : {}) };
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
      const at = { ...editor, hover: e.cell };
      const hit = partAt(bp, registry, e.cell.x, e.cell.y);
      if (e.button === 'right') {
        // With something in hand a right-click puts it down. With an empty hand it picks the part to look at: the
        // selection when the part is in it, else just that part.
        if (handFull(editor)) return { editor: emptied(at), bp };
        if (!hit) return { editor: at, bp };
        return { editor: { ...at, selection: editor.selection.includes(hit.id) ? editor.selection : [hit.id] }, bp, focus: true };
      }
      if (e.alt === true) {
        // Alt+click: another like that one. A copy of that very part (type, turn, groups, settings) goes into the hand.
        if (!hit) return { editor: at, bp };
        return { editor: { ...emptied(at), copy: copyOf(bp, stampOfParts(bp, [hit.id]), [hit.id]), selection: [] }, bp };
      }
      if (editor.stamp) {
        // A held blueprint is placed whole in one click (one undo step), or refused whole.
        const r = placeStamp(bp, editor.stamp, e.cell, editor.mirror, registry);
        return r.ok ? { editor: { ...at, selection: [] }, bp: r.bp } : { editor: at, bp, refused: sentence(r.error) };
      }
      if (editor.copy && editor.copy.stamp.parts.length !== 1) {
        // A copy of several parts lands whole in one click, like a held blueprint.
        const r = placeCopy(bp, registry, editor.copy, e.cell, editor.mirror);
        return r.ok ? { editor: { ...at, selection: [] }, bp: r.bp, fx: r.fx } : { editor: at, bp, refused: r.error };
      }
      if (handFull(editor)) {
        const g: Extract<Gesture, { kind: 'paint' | 'erase' }> = editor.eraser ? { kind: 'erase', start: e.cell, last: e.cell } : { kind: 'paint', start: e.cell, last: e.cell, swap: e.shift };
        // Painting or erasing ends a selection, so a stale id never lands on a new part in the same cell.
        const r = applyAlong(editor, bp, g, [e.cell], registry);
        return { editor: { ...at, gesture: g, selection: [] }, bp: r.bp, gesture: 'begin', ...(r.fx ? { fx: r.fx } : {}), ...(r.refused !== undefined ? { refused: r.refused } : {}) };
      }
      // An empty hand.
      if (!hit) return { editor: { ...at, gesture: { kind: 'box', start: e.cell, last: e.cell, keep: e.shift ? editor.selection : [] }, selection: e.shift ? editor.selection : [] }, bp };
      if (e.shift) {
        // Shift+click adds or removes one. Added, it can be dragged along with the rest.
        const had = editor.selection.includes(hit.id);
        const selection = had ? editor.selection.filter((id) => id !== hit.id) : [...editor.selection, hit.id];
        return { editor: { ...at, selection, ...(had ? {} : { gesture: { kind: 'move' as const, start: e.cell, last: e.cell, ids: selection } }) }, bp };
      }
      const among = editor.selection.includes(hit.id);
      const selection = among ? editor.selection : [hit.id];
      return { editor: { ...at, selection, gesture: { kind: 'move', start: e.cell, last: e.cell, ids: selection, ...(among && selection.length > 1 ? { narrowTo: hit.id } : {}) } }, bp };
    }
    case 'move': {
      const g = editor.gesture;
      if (!g) return { editor: { ...editor, hover: e.cell }, bp };
      if (g.last.x === e.cell.x && g.last.y === e.cell.y) return { editor: { ...editor, hover: e.cell }, bp };
      const next = { ...editor, hover: e.cell, gesture: { ...g, last: e.cell } };
      if (g.kind === 'move') return { editor: next, bp };
      if (g.kind === 'box') return { editor: { ...next, selection: boxSelection(bp, registry, g, e.cell) }, bp };
      const r = applyAlong(editor, bp, g, lineCells(g.last, e.cell), registry);
      return { editor: next, bp: r.bp, ...(r.fx ? { fx: r.fx } : {}), ...(r.refused !== undefined ? { refused: r.refused } : {}) };
    }
    case 'up': {
      const g = editor.gesture;
      if (!g) return { editor, bp };
      const { gesture: _gesture, ...rest } = editor;
      const done = { ...rest, hover: e.cell };
      if (g.kind === 'box') return { editor: { ...done, selection: boxSelection(bp, registry, g, e.cell) }, bp };
      if (g.kind === 'move') {
        const dx = e.cell.x - g.start.x;
        const dy = e.cell.y - g.start.y;
        if (dx === 0 && dy === 0) return { editor: g.narrowTo !== undefined ? { ...done, selection: [g.narrowTo] } : done, bp };
        const r = moveSelection(bp, registry, g.ids, dx, dy, editor.mirror);
        if (!r.ok) return { editor: done, bp, refused: r.error };
        // The whole selection goes on being the selection, under its new ids.
        const moved = new Map(g.ids.map((id, i) => [id, r.selection[i] ?? id]));
        return { editor: { ...done, selection: editor.selection.map((id) => moved.get(id) ?? id) }, bp: r.bp, fx: { renames: r.renames } };
      }
      const moved = reduce(editor, bp, { type: 'move', cell: e.cell }, registry, partIds);
      return { editor: done, bp: moved.bp, gesture: 'end', ...(moved.fx ? { fx: moved.fx } : {}), ...(moved.refused !== undefined ? { refused: moved.refused } : {}) };
    }
  }
}
