import { staticStats, toFileJson, validateBlueprint, type Blueprint, type Issue, type PartRegistry } from '@robots/sim-core';
import { panByPixels, zoomBy } from '../render/camera';
import type { Store } from '../ui/store';
import type { AppState } from '../ui/appState';
import { History } from './history';
import { initialEditor, reduce, type Cell, type EditorEvent, type EditorState } from './editorState';
import type { BuilderScene, Overlay } from './BuilderScene';

/** The builder screen's controller: input goes through the pure reducer and history, output goes to the scene and store. */
export class Builder {
  readonly history: History;
  editor: EditorState = initialEditor();
  private readonly registry: PartRegistry;
  private readonly partIds: string[];
  private readonly scene: BuilderScene;
  private readonly store: Store<AppState>;
  private issues: Issue[] = [];
  private panning: { id: number; x: number; y: number } | null = null;
  private spaceDown = false;

  constructor(registry: PartRegistry, scene: BuilderScene, store: Store<AppState>, initial: Blueprint) {
    this.registry = registry;
    this.partIds = registry.ids();
    this.scene = scene;
    this.store = store;
    this.history = new History(initial);
    this.refresh(true);
  }

  get draft(): Blueprint {
    return this.history.present;
  }

  /** Replace the draft (open, new). Clears undo history and selection. */
  load(bp: Blueprint): void {
    this.history.reset(bp);
    this.editor = initialEditor();
    this.refresh(true);
  }

  /** Apply an edit made outside the canvas (panels), as one undo step. */
  edit(fn: (bp: Blueprint) => Blueprint): void {
    const next = fn(this.draft);
    if (next === this.draft) return;
    this.history.commit(next);
    this.refresh(true);
  }

  select(ids: string[]): void {
    this.editor = { ...this.editor, selection: ids };
    this.refresh(false);
  }

  dispatch(e: EditorEvent): void {
    const before = this.draft;
    const r = reduce(this.editor, before, e, this.registry, this.partIds);
    this.editor = r.editor;
    if (r.gesture === 'begin') this.history.beginGesture();
    this.history.commit(r.bp);
    if (r.gesture === 'end') this.history.endGesture();
    this.refresh(r.bp !== before);
  }

  /** Ignored mid-drag: undoing inside an open gesture would cut the rest of the drag out of history. */
  undo(): void {
    if (!this.editor.gesture && this.history.undo()) this.refresh(true);
  }

  redo(): void {
    if (!this.editor.gesture && this.history.redo()) this.refresh(true);
  }

  renameHistory(name: string): void {
    this.history.renameAll(name);
    this.refresh(true);
  }

  /** Closes any open drag (leaving the builder, losing focus). */
  endGesture(): void {
    this.panning = null;
    this.spaceDown = false;
    if (this.editor.gesture) this.dispatch({ type: 'endGesture' });
  }

  onPointerDown(e: PointerEvent, cell: Cell): void {
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.dispatch({ type: 'down', cell, button: e.button === 2 ? 'right' : 'left', shift: e.shiftKey });
  }

  onPointerMove(e: PointerEvent, cell: Cell): void {
    if (this.panning && e.pointerId === this.panning.id) {
      this.scene.cam = panByPixels(this.scene.cam, e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const h = this.editor.hover;
    if (h && h.x === cell.x && h.y === cell.y && !this.editor.gesture) return;
    this.dispatch({ type: 'move', cell });
  }

  onPointerUp(e: PointerEvent, cell: Cell): void {
    if (this.panning && e.pointerId === this.panning.id) {
      this.panning = null;
      return;
    }
    this.dispatch({ type: 'up', cell });
  }

  onWheel(e: WheelEvent): void {
    this.scene.cam = zoomBy(this.scene.cam, Math.exp(-e.deltaY * 0.0015));
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.spaceDown = false;
  }

  /** Returns true when the key was a builder shortcut. */
  onKeyDown(e: KeyboardEvent): boolean {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ') {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && e.code === 'KeyY') {
      this.redo();
      return true;
    }
    if (mod) return false;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      this.dispatch({ type: 'pick', index: Number(digit[1]) - 1 });
      return true;
    }
    switch (e.code) {
      case 'Space':
        this.spaceDown = true;
        return true;
      case 'KeyR':
        this.dispatch({ type: 'rotate', dir: e.shiftKey ? -1 : 1 });
        return true;
      case 'Delete':
      case 'Backspace':
        this.dispatch({ type: 'deleteSelection' });
        return true;
      case 'Escape':
        this.dispatch({ type: 'escape' });
        return true;
      case 'KeyM':
        this.dispatch({ type: 'toggleMirror' });
        return true;
      case 'BracketLeft':
      case 'BracketRight':
        if (!this.editor.mirror.on) return false;
        this.dispatch({ type: 'shiftAxis', delta: e.code === 'BracketLeft' ? -1 : 1 });
        return true;
      default:
        return false;
    }
  }

  frame(w: number, h: number): void {
    this.scene.frame(w, h);
  }

  private overlay(): Overlay {
    const errorCells: Cell[] = [];
    const warningCells: Cell[] = [];
    for (const i of this.issues) {
      const part = i.partId ? this.draft.parts.find((p) => p.id === i.partId) : undefined;
      const cell = i.cell ?? (part ? { x: part.x, y: part.y } : undefined);
      if (cell) (i.severity === 'error' ? errorCells : warningCells).push(cell);
    }
    const stats = staticStats(this.draft, this.registry);
    const g = this.editor.gesture;
    return {
      errorCells,
      warningCells,
      ...(stats.massKg > 0 ? { com: { x: stats.comX, y: stats.comY } } : {}),
      selection: this.editor.selection,
      ...(g?.kind === 'select' && (g.start.x !== g.last.x || g.start.y !== g.last.y) ? { box: { a: g.start, b: g.last } } : {}),
    };
  }

  private refresh(draftChanged: boolean): void {
    const bp = this.draft;
    if (draftChanged) {
      this.issues = validateBlueprint(toFileJson(bp, this.registry), this.registry).issues;
      this.scene.drawParts(bp, this.registry);
    }
    this.scene.drawGhost(this.editor, bp, this.registry);
    this.scene.drawOverlay(this.overlay(), this.editor, bp, this.registry);
    const e = this.editor;
    this.store.set({
      builder: {
        draft: bp,
        ...(e.held ? { held: e.held } : {}),
        selection: e.selection,
        mirror: e.mirror,
        canUndo: this.history.canUndo,
        canRedo: this.history.canRedo,
        issues: this.issues,
        stats: staticStats(bp, this.registry),
      },
    });
  }
}
