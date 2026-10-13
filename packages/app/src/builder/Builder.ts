import { addTagToParts, staticStats, toFileJson, validateBlueprint, type Blueprint, type Issue, type PartRegistry, type StaticStats } from '@robots/sim-core';
import { panByPixels, zoomBy } from '../render/camera';
import type { Store } from '../ui/store';
import type { AppState, CursorNote } from '../ui/appState';
import { History } from './history';
import { handFull, initialEditor, reduce, type Cell, type EditorEvent, type EditorState } from './editorState';
import { cellsOfPart, groupOffers, swapParts, type Fx, type GroupOffer } from './boardOps';
import type { BuilderScene, Overlay } from './BuilderScene';
import { controlCores, controlsOf, type ControlsView } from './coreControls';
import { editNote, swapLines, type NoteLine } from './notice';
import { applyNameFix, scriptProblems, showScript, type NameFix, type ScriptProblem, type ScriptShow } from './scriptView';

/** The builder screen's controller: input goes through the pure reducer and history, output goes to the scene and store. */
export class Builder {
  readonly history: History;
  editor: EditorState = initialEditor();
  private readonly registry: PartRegistry;
  /** The hotbar (M16): what the keys 1 to 9 pick, in order. An empty slot is an empty string, which no part has. */
  private hotbar: string[];
  /** Told each time a different part is taken in hand (the drawer's recent row). */
  onHold: ((part: string) => void) | undefined;
  /** Where the canvas sits in the window, so a note can be put at a cell. */
  origin: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  private readonly scene: BuilderScene;
  private readonly store: Store<AppState>;
  private issues: Issue[] = [];
  private problems: ScriptProblem[] = [];
  private panning: { id: number; x: number; y: number } | null = null;
  /** Counts right-clicks on a part, so the inspector can turn to its Part tab on each one. */
  private partFocus = 0;
  /** Worked out from the draft once per change, not on every move of the mouse. */
  private stats: StaticStats;
  private controls: { bp: Blueprint; core: string | undefined; view: ControlsView; cores: { core?: string; label: string }[] } | undefined;
  private spaceDown = false;
  /** Shift is down: the ghost shows a swap where the cell is taken. */
  private shift = false;
  /** The canvas size as of the last frame drawn. */
  private screen = { w: 1440, h: 900 };
  /** Where the mouse last was, in window pixels. */
  private pointer: { x: number; y: number } | undefined;
  /** The undo step being made: the blueprint it started from and what it has done so far. One drag is one step. */
  private step: { before: Blueprint; fx: Fx } | undefined;
  private inGesture = false;
  /** What the last edit affected (M16), with Undo in it. Gone at the next edit. */
  private note: { seq: number; lines: NoteLine[]; undo: boolean } | undefined;
  /** A refusal or an offer at the cursor. */
  private cursorNote: CursorNote | undefined;
  private seq = 0;
  /** The script whose reach is lit on the board, by id, among the scripts of the core the panels are on. */
  private shownId: string | undefined;
  /** The same, for as long as the mouse rests on a script's row: it wins over `shownId` and leaves it alone. */
  private peekId: string | undefined;
  private shown: { bp: Blueprint; core: string | undefined; id: string; view: ScriptShow | undefined } | undefined;
  /** The core whose controls the panels edit (M7); undefined is the main core. */
  controlsFor: string | undefined;

  constructor(registry: PartRegistry, scene: BuilderScene, store: Store<AppState>, initial: Blueprint) {
    this.registry = registry;
    this.hotbar = registry.ids().slice(0, 9);
    this.stats = staticStats(initial, registry);
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
    this.controlsFor = undefined;
    this.step = undefined;
    this.inGesture = false;
    this.note = undefined;
    this.cursorNote = undefined;
    this.shownId = undefined;
    // A robot just opened sits in the middle of the board, all of it in view.
    this.scene.show(bp, this.registry, this.screen);
    this.refresh(true);
  }

  /** Sets what the keys 1 to 9 pick. */
  setHotbar(slots: ReadonlyArray<string | null>): void {
    this.hotbar = slots.map((s) => s ?? '');
  }

  /** Picks the core the Controls and Scripts panels edit. */
  setControlsFor(core: string | undefined): void {
    if (core !== this.controlsFor) {
      this.shownId = undefined;
      this.peekId = undefined;
    }
    this.controlsFor = core;
    this.refresh(false);
  }

  /** Apply an edit made outside the canvas (panels), as one undo step. */
  edit(fn: (bp: Blueprint) => Blueprint): void {
    const next = fn(this.draft);
    if (next === this.draft) return;
    this.history.commit(next);
    this.note = undefined;
    this.cursorNote = undefined;
    this.refresh(true);
  }

  /** Text typed in the script editor coalesces into one undo step until the editor loses focus. */
  beginTextEdit(): void {
    this.history.beginGesture();
  }

  endTextEdit(): void {
    this.history.endGesture();
  }

  select(ids: string[]): void {
    this.editor = { ...this.editor, selection: ids };
    this.refresh(false);
  }

  /** Lights up on the board what one script of the core in the panels reaches; undefined puts the light out. */
  showScript(id: string | undefined): void {
    if (id === this.shownId) return;
    this.shownId = id;
    this.refresh(false);
  }

  /** Lights up a script's reach for now (the mouse is on its row); undefined goes back to the one kept lit, if any. */
  peekScript(id: string | undefined): void {
    if (id === this.peekId) return;
    this.peekId = id;
    this.refresh(false);
  }

  /**
   * Swap to (M16): the given parts become another type where they stand, all of them or none, as one undo step. What
   * was kept, what was dropped and what will not work is said after it, not asked before.
   */
  swapTo(ids: readonly string[], type: string): void {
    const r = swapParts(this.draft, this.registry, ids, type);
    if (!r.ok) {
      this.say([{ text: `Not swapped: ${r.error}`, bad: true }], false);
      return;
    }
    if (r.bp === this.draft) return;
    this.history.commit(r.bp);
    this.editor = { ...this.editor, selection: this.editor.selection.map((id) => r.ids.get(id) ?? id) };
    this.cursorNote = undefined;
    this.note = { seq: ++this.seq, lines: swapLines(r.swaps, this.registry), undo: true };
    this.refresh(true);
  }

  /** Accepts an offer made at the cursor: the parts just placed join the group. One undo step. */
  acceptOffer(offer: GroupOffer): void {
    const before = this.draft;
    this.edit((bp) => addTagToParts(bp, offer.ids.filter((id) => bp.parts.some((p) => p.id === id)), offer.tag));
    if (this.draft !== before) this.say([{ text: `Added to group ${offer.tag}. Keys and scripts that drive the group drive ${offer.ids.length === 1 ? 'it' : 'them'} now.` }], true);
  }

  /** Points a dead name in a script at a real one, as one undo step. */
  fixName(fix: NameFix): void {
    const before = this.draft;
    this.edit((bp) => applyNameFix(bp, this.registry, fix));
    if (this.draft !== before) this.say([{ text: `Pointed '${fix.from}' at '${fix.to}'${fix.spots.length > 1 ? ` in ${fix.spots.length} places` : ''}.` }, { text: `It reads: ${fix.after}` }], true);
    else this.say([{ text: `Not changed: the script no longer reads '${fix.from}' there.`, bad: true }], false);
  }

  dismissNote(seq: number): void {
    if (this.note?.seq !== seq) return;
    this.note = undefined;
    this.refresh(false);
  }

  dismissCursorNote(seq: number): void {
    if (this.cursorNote?.seq !== seq) return;
    this.cursorNote = undefined;
    this.refresh(false);
  }

  private say(lines: NoteLine[], undo: boolean): void {
    this.note = { seq: ++this.seq, lines, undo };
    this.refresh(false);
  }

  /** Where a note about this event goes: by the selection for a key (the mouse may be anywhere), else at the cursor. */
  private noteSpot(byKey: boolean): { x: number; y: number } {
    const first = byKey ? this.draft.parts.find((p) => this.editor.selection.includes(p.id)) : undefined;
    if (first) {
      const cells = cellsOfPart(first, this.registry);
      const top = cells.reduce((a, c) => (c.y > a.y || (c.y === a.y && c.x > a.x) ? c : a), cells[0] ?? first);
      const p = this.scene.pointOf(top, this.screen.w, this.screen.h);
      const o = this.origin();
      return { x: o.x + p.x, y: o.y + p.y - 30 };
    }
    return this.pointer ?? { x: this.screen.w / 2, y: this.screen.h / 2 };
  }

  dispatch(e: EditorEvent): void {
    const before = this.draft;
    const held = this.editor.held?.part;
    const idle = !handFull(this.editor) && this.editor.selection.length === 0 && !this.editor.gesture;
    const r = reduce(this.editor, before, e, this.registry, this.hotbar);
    this.editor = r.editor;
    const now = r.editor.held?.part;
    if (now !== undefined && now !== held) this.onHold?.(now);
    if (r.gesture === 'begin') {
      this.history.beginGesture();
      this.inGesture = true;
    }
    if (r.bp !== before) {
      // A new edit: what was said about the last one is over.
      this.step ??= { before, fx: {} };
      this.note = undefined;
      this.cursorNote = undefined;
    }
    if (r.fx && this.step) {
      const renames = new Map(this.step.fx.renames ?? []);
      for (const [from, to] of r.fx.renames ?? []) renames.set(from, to);
      this.step.fx = { placed: [...(this.step.fx.placed ?? []), ...(r.fx.placed ?? [])], swaps: [...(this.step.fx.swaps ?? []), ...(r.fx.swaps ?? [])], renames, named: [...(this.step.fx.named ?? []), ...(r.fx.named ?? [])] };
    }
    this.history.commit(r.bp);
    if (r.gesture === 'end') {
      this.history.endGesture();
      this.inGesture = false;
    }
    if (r.focus) this.partFocus++;
    // A reason at the cursor is about the last thing done: the next press or key is a new thing.
    if (this.cursorNote?.text !== undefined && e.type !== 'move' && e.type !== 'up') this.cursorNote = undefined;
    const byKey = e.type === 'nudge' || e.type === 'rotate';
    if (r.refused !== undefined) this.cursorNote = { seq: ++this.seq, ...this.noteSpot(byKey), text: r.refused };
    if (this.step && !this.inGesture) this.closeStep(r.refused === undefined);
    // Esc with nothing in hand, nothing selected and no drag puts out the script light.
    if (e.type === 'escape' && idle) this.shownId = undefined;
    this.refresh(r.bp !== before);
  }

  /** One undo step is done: say what it affected, and offer a group to blank parts that landed among grouped ones. */
  private closeStep(mayOffer: boolean): void {
    const step = this.step;
    this.step = undefined;
    if (!step || step.before === this.draft) return;
    const note = editNote(step.before, this.draft, this.registry, step.fx);
    if (note) this.note = { seq: ++this.seq, lines: note.lines, undo: true };
    const offers = mayOffer ? groupOffers(this.draft, this.registry, step.fx.placed ?? []) : [];
    if (offers.length > 0) this.cursorNote = { seq: ++this.seq, ...this.noteSpot(false), offers };
  }

  /** Ignored mid-drag: undoing inside an open gesture would cut the rest of the drag out of history. */
  undo(): void {
    if (this.editor.gesture || !this.history.undo()) return;
    this.afterTravel();
  }

  redo(): void {
    if (this.editor.gesture || !this.history.redo()) return;
    this.afterTravel();
  }

  /** After undo or redo: ids that no longer exist leave the selection, and what was said about the last edit goes. */
  private afterTravel(): void {
    const ids = new Set(this.draft.parts.map((p) => p.id));
    this.editor = { ...this.editor, selection: this.editor.selection.filter((id) => ids.has(id)) };
    this.note = undefined;
    this.cursorNote = undefined;
    this.refresh(true);
  }

  renameHistory(name: string): void {
    this.history.renameAll(name);
    this.refresh(true);
  }

  /** Closes any open drag (leaving the builder, losing focus). */
  endGesture(): void {
    this.panning = null;
    this.spaceDown = false;
    this.shift = false;
    if (this.editor.gesture) this.dispatch({ type: 'endGesture' });
  }

  private setShift(on: boolean): void {
    if (on === this.shift) return;
    this.shift = on;
    if (handFull(this.editor)) this.refresh(false);
  }

  onPointerDown(e: PointerEvent, cell: Cell): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.shift = e.shiftKey;
    this.dispatch({ type: 'down', cell, button: e.button === 2 ? 'right' : 'left', shift: e.shiftKey, alt: e.altKey });
  }

  onPointerMove(e: PointerEvent, cell: Cell): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.panning && e.pointerId === this.panning.id) {
      this.scene.cam = panByPixels(this.scene.cam, e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const h = this.editor.hover;
    if (h && h.x === cell.x && h.y === cell.y) {
      this.setShift(e.shiftKey);
      return;
    }
    this.shift = e.shiftKey;
    this.dispatch({ type: 'move', cell });
  }

  onPointerUp(e: PointerEvent, cell: Cell): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.panning && e.pointerId === this.panning.id) {
      this.panning = null;
      return;
    }
    this.dispatch({ type: 'up', cell });
  }

  onWheel(e: WheelEvent): void {
    this.scene.cam = zoomBy(this.scene.cam, Math.exp(-e.deltaY * 0.0015));
    // The overlay's hairlines are drawn for a zoom.
    this.refresh(false);
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.spaceDown = false;
    if (e.key === 'Shift') this.setShift(false);
  }

  /** Returns true when the key was a builder shortcut. */
  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Shift') this.setShift(true);
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
    if (mod && e.code === 'KeyD') {
      // A copy of the selection in the hand. Never the browser's "bookmark this page".
      this.dispatch({ type: 'duplicate' });
      return true;
    }
    if (mod && e.code === 'KeyA') {
      this.dispatch({ type: 'selectAll' });
      return true;
    }
    if (mod) return false;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      // 1 to 9 pick the hotbar's slots (M16). An empty slot picks nothing.
      this.dispatch({ type: 'pick', index: Number(digit[1]) - 1 });
      return true;
    }
    const arrow: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const step = arrow[e.code];
    if (step) {
      // Arrows nudge the selection a cell. With nothing selected they are nobody's.
      if (this.editor.selection.length === 0 || handFull(this.editor)) return false;
      this.dispatch({ type: 'nudge', dx: step[0], dy: step[1] });
      return true;
    }
    switch (e.code) {
      case 'Space':
        this.spaceDown = true;
        return true;
      case 'KeyE':
        this.dispatch({ type: 'eraser' });
        return true;
      case 'KeyR':
        this.dispatch({ type: 'rotate', dir: e.shiftKey ? -1 : 1 });
        return true;
      case 'KeyF':
        // Flips a held robot or a held copy left to right.
        if (!this.editor.stamp && !this.editor.copy) return false;
        this.dispatch({ type: 'flip' });
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
    this.screen = { w, h };
    this.scene.frame(w, h);
  }

  private shownView(): ScriptShow | undefined {
    const id = this.peekId ?? this.shownId;
    if (id === undefined) return undefined;
    const bp = this.draft;
    if (!this.shown || this.shown.bp !== bp || this.shown.core !== this.controlsFor || this.shown.id !== id) this.shown = { bp, core: this.controlsFor, id, view: showScript(bp, this.registry, this.controlsFor, id) };
    // A script that is gone (removed, renamed, undone away) lights nothing.
    if (!this.shown.view) {
      if (this.peekId === id) this.peekId = undefined;
      else this.shownId = undefined;
    }
    return this.shown.view;
  }

  private overlay(shown: ScriptShow | undefined): Overlay {
    const errorCells: Cell[] = [];
    const warningCells: Cell[] = [];
    for (const i of this.issues) {
      const part = i.partId ? this.draft.parts.find((p) => p.id === i.partId) : undefined;
      const cell = i.cell ?? (part ? { x: part.x, y: part.y } : undefined);
      if (cell) (i.severity === 'error' ? errorCells : warningCells).push(cell);
    }
    const stats = this.stats;
    const g = this.editor.gesture;
    return {
      errorCells,
      warningCells,
      ...(stats.massKg > 0 ? { com: { x: stats.comX, y: stats.comY } } : {}),
      selection: this.editor.selection,
      ...(g?.kind === 'box' && (g.start.x !== g.last.x || g.start.y !== g.last.y) ? { box: { a: g.start, b: g.last } } : {}),
      ...(shown ? { reach: { reached: shown.reached, fits: shown.fits, undriven: shown.undriven.map((u) => u.part) } } : {}),
      swap: this.shift,
    };
  }

  private refresh(draftChanged: boolean): void {
    const bp = this.draft;
    if (draftChanged) {
      this.issues = validateBlueprint(toFileJson(bp, this.registry), this.registry).issues;
      this.problems = scriptProblems(bp, this.registry);
      this.stats = staticStats(bp, this.registry);
      this.scene.drawParts(bp, this.registry);
    }
    const e = this.editor;
    if (this.controls?.bp !== bp) this.controls = undefined;
    const cores = this.controls?.cores ?? controlCores(bp, this.registry);
    // A core that was erased (or undone away) falls back to the main core.
    // The open script editor goes too: it names a script by id, and the main core may have one of the same name.
    if (this.controlsFor !== undefined && !cores.some((c) => c.core === this.controlsFor)) {
      this.controlsFor = undefined;
      this.shownId = undefined;
      this.store.set({ scriptEditor: undefined });
    }
    if (!this.controls || this.controls.core !== this.controlsFor) this.controls = { bp, core: this.controlsFor, view: controlsOf(bp, this.registry, this.controlsFor), cores };
    const shown = this.shownView();
    this.scene.drawGhost(e, bp, this.registry, this.shift);
    this.scene.drawOverlay(this.overlay(shown), e, bp, this.registry);
    const copy = e.copy;
    const copied = copy ? copy.stamp.parts : [];
    const g = e.gesture;
    this.store.set({
      builder: {
        draft: bp,
        ...(e.held ? { held: e.held } : {}),
        ...(e.stamp ? { stamp: { name: e.stamp.name, rot: e.stamp.rot, flipped: e.stamp.flipped } } : {}),
        ...(copy
          ? {
              copy: {
                types: copied.map((p) => p.part),
                rot: copy.rot,
                flipped: copy.flipped,
                groups: [...new Set(copied.flatMap((p) => p.tags.filter((t) => t !== p.id)))],
              },
            }
          : {}),
        ...(this.controlsFor !== undefined ? { controlsFor: this.controlsFor } : {}),
        controls: this.controls.view,
        cores,
        eraser: e.eraser === true,
        selection: e.selection,
        ...(e.hover ? { hover: e.hover } : {}),
        ...(g ? { dragging: g.kind } : {}),
        partFocus: this.partFocus,
        mirror: e.mirror,
        canUndo: this.history.canUndo,
        canRedo: this.history.canRedo,
        issues: this.issues,
        scriptProblems: this.problems,
        stats: this.stats,
        ...(this.note ? { note: this.note } : {}),
        ...(this.cursorNote ? { cursorNote: this.cursorNote } : {}),
        ...(shown ? { shown } : {}),
        ...(this.shownId !== undefined ? { shownPinned: this.shownId } : {}),
      },
    });
  }
}
