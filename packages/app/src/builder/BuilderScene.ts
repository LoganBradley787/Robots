import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { movePartsBy, partAt, partCells, type Blueprint, type PartRegistry, type PlacedPart, type Rotation } from '@robots/sim-core';
import { applyCamera } from '../render/cameraView';
import { createCamera, screenToWorld, type CameraState } from '../render/camera';
import { addPartSprites } from '../render/partDraw';
import { PIXELS_PER_METER, toScreen } from '../render/units';
import { copyGhost, eraseTargets, moveSteps, placeCopy, placeHeld, type Cell } from './boardOps';
import { handFull, type EditorState } from './editorState';
import { stampGhost } from './stamp';

/**
 * The board's colours (M16, look: Shop floor). They repeat the tokens in `ui/styles.css` (--board, --grid,
 * --grid-major, --sel, --warn, --bad, --reach), because PixiJS draws the board and cannot read CSS.
 */
export const BUILDER_BG = 0x1b1e21;
const GRID = 0x2a2f34;
const GRID_MAJOR = 0x3a4047;
const SELECT = 0xf2b705;
const WARN = 0xe08a2e;
const BAD = 0xe5533c;
/** What a script reaches: a cool colour, so it is never taken for the selection (yellow) or a problem (orange, red). */
const REACH = 0x3fc1d4;
/** What is picked for a behavior's slot (M16): green, so it is never taken for the selection, a script's reach, or a problem. Repeats --pick. */
const PICK = 0x8fe36a;
const INK = 0xe6e2d6;
const GHOST_BAD = 0xff7a7a;
const GHOST_SWAP = 0xffd76a;

export interface Overlay {
  /** Cells with validator errors and warnings. */
  errorCells: Cell[];
  warningCells: Cell[];
  /** Center of mass in cell coordinates, if there are parts. */
  com?: { x: number; y: number };
  selection: string[];
  /** Selection box corners while box selecting. */
  box?: { a: Cell; b: Cell };
  /**
   * What the script being shown drives (M16): the parts it reaches by a plain name, the parts that fit a name it
   * builds in code, and the parts that look like they belong and are not driven. Everything else is dimmed.
   */
  reach?: { reached: readonly string[]; fits: readonly string[]; undriven: readonly string[] };
  /** Shift is down: a part placed on a taken cell swaps what is there. */
  swap?: boolean;
  /**
   * A behavior's slot being filled (M16): the parts picked for it, and the parts that could be. Everything else is
   * dimmed, and nothing else is lit while it lasts.
   */
  pick?: { chosen: readonly string[]; could: readonly string[] };
}

/** Draws the builder: background, grid, parts, the held-part ghost, and overlays. Reads state, never edits it. */
export class BuilderScene {
  cam: CameraState = { ...createCamera(3, 2), zoom: 2 };
  private readonly bg = new Graphics();
  private readonly content = new Container();
  private readonly grid = new Graphics();
  private readonly parts = new Container();
  private readonly ghost = new Container();
  private readonly overlay = new Graphics();
  private readonly texture: (name: string) => Texture;
  private bgSize = { w: 0, h: 0 };
  /** What the grid was last drawn for: it covers what is in view, however far the board is moved (it has no edge). */
  private gridKey = '';
  private mirror: { on: boolean; axisHalfCells: number } = { on: false, axisHalfCells: 0 };
  /** What the panels cover of the canvas, from each edge, in pixels: the board the player sees is what is left. */
  private insets: { left: number; right: number; top: number; bottom: number };
  /** Where the middle of that board is, from the middle of the canvas. */
  private offset: { x: number; y: number };

  constructor(root: Container, frame: (name: string) => Texture, insets: { left: number; right: number; top: number; bottom: number } = { left: 0, right: 0, top: 0, bottom: 0 }) {
    this.texture = frame;
    this.insets = insets;
    this.offset = { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
    this.content.addChild(this.grid, this.parts, this.overlay, this.ghost);
    root.addChild(this.bg, this.content);
  }

  /** What the panels cover now (the script view takes more of the left while it is open). The view stays where it is on the canvas. */
  setInsets(insets: { left: number; right: number; top: number; bottom: number }): void {
    const next = { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
    // Keep what is under the old middle under it still: only `show` moves the view.
    const s = this.cam.zoom * PIXELS_PER_METER;
    this.cam = { ...this.cam, x: this.cam.x + (next.x - this.offset.x) / s, y: this.cam.y - (next.y - this.offset.y) / s };
    this.insets = insets;
    this.offset = next;
    this.gridKey = '';
  }

  /**
   * The grid over the cells in view, and the mirror line. Lines sit on cell edges (half-integers), since parts sit on
   * integer cell centers. Zoomed far out, the fine lines go and the heavy ones thin out, so it never turns to a wash.
   */
  private drawGrid(w: number, h: number): void {
    const key = `${this.cam.x},${this.cam.y},${this.cam.zoom},${w},${h},${this.mirror.on ? this.mirror.axisHalfCells : 'off'}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    const g = this.grid;
    g.clear();
    const a = screenToWorld(this.cam, -this.offset.x, -this.offset.y, w, h);
    const b = screenToWorld(this.cam, w - this.offset.x, h - this.offset.y, w, h);
    const [x0, x1] = [Math.floor(Math.min(a.x, b.x)) - 1, Math.ceil(Math.max(a.x, b.x)) + 1];
    const [y0, y1] = [Math.floor(Math.min(a.y, b.y)) - 1, Math.ceil(Math.max(a.y, b.y)) + 1];
    const cellPx = this.cam.zoom * PIXELS_PER_METER;
    let major = 5;
    while (major * cellPx < 12) major *= 5;
    const line = (ax: number, ay: number, bx: number, by: number): void => {
      const p = toScreen({ x: ax, y: ay });
      const q = toScreen({ x: bx, y: by });
      g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    };
    const levels: Array<{ keep: (i: number) => boolean; color: number; show: boolean }> = [
      { keep: (i) => i % 5 !== 0, color: GRID, show: cellPx >= 6 },
      { keep: (i) => i % major === 0, color: GRID_MAJOR, show: true },
    ];
    for (const { keep, color, show } of levels) {
      if (!show) continue;
      for (let i = x0; i <= x1; i++) if (keep(i)) line(i - 0.5, y0, i - 0.5, y1);
      for (let i = y0; i <= y1; i++) if (keep(i)) line(x0, i - 0.5, x1, i - 0.5);
      g.stroke({ color, pixelLine: true });
    }
    if (this.mirror.on) {
      const ax = this.mirror.axisHalfCells / 2;
      // Dashes of a size that reads at any zoom.
      const dash = Math.max(0.25, 8 / cellPx);
      for (let y = Math.floor(y0 / (2 * dash)) * 2 * dash; y < y1; y += 2 * dash) line(ax, y, ax, y + dash);
      g.stroke({ color: SELECT, width: 2 / this.cam.zoom, alpha: 0.9 });
    }
  }

  private addPart(into: Container, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation, alpha = 1, armed = false, size?: [number, number]): void {
    addPartSprites(into, this.texture, registry, part, x, y, rot, alpha, armed, size);
  }

  drawParts(bp: Blueprint, registry: PartRegistry): void {
    for (const c of this.parts.removeChildren()) c.destroy();
    for (const p of bp.parts) this.addPart(this.parts, registry, p.part, p.x, p.y, p.rot, 1, p.armed === true, p.size);
  }

  private tintGhost(from: number, color: number): void {
    for (const c of this.ghost.children.slice(from)) (c as Sprite).tint = color;
  }

  /** What is in the hand, where a click would put it: red where the click would be refused, amber where it would swap. */
  drawGhost(editor: EditorState, bp: Blueprint, registry: PartRegistry, swap = false): void {
    for (const c of this.ghost.removeChildren()) c.destroy();
    const h = editor.hover;
    const g = editor.gesture;
    if (g?.kind === 'move') {
      // The selection on its way: where it would land.
      const dx = g.last.x - g.start.x;
      const dy = g.last.y - g.start.y;
      if (dx === 0 && dy === 0) return;
      const steps = moveSteps(bp, registry, g.ids, dx, dy, editor.mirror);
      for (const p of bp.parts) {
        const s = steps.get(p.id);
        if (s) this.addPart(this.ghost, registry, p.part, p.x + s.dx, p.y + s.dy, p.rot, 0.6, p.armed === true, p.size);
      }
      if (!movePartsBy(bp, registry, steps).ok) this.tintGhost(0, GHOST_BAD);
      return;
    }
    if (!h) return;
    if (editor.stamp) {
      // A held blueprint: every part it would add, red where a click would be refused (an overlap).
      const s = stampGhost(bp, editor.stamp, h, editor.mirror, registry);
      for (const p of s.parts) this.addPart(this.ghost, registry, p.part, p.x, p.y, p.rot, 0.55, p.armed === true, p.size);
      if (!s.ok) this.tintGhost(0, GHOST_BAD);
      return;
    }
    if (editor.copy) {
      for (const p of copyGhost(editor.copy, h, editor.mirror, registry)) this.addPart(this.ghost, registry, p.part, p.x, p.y, p.rot, 0.55, p.armed === true, p.size);
      const one = editor.copy.stamp.parts.length === 1;
      const taken = one && partAt(bp, registry, h.x, h.y) !== undefined;
      if (swap && taken) this.tintGhost(0, GHOST_SWAP);
      else if (!placeCopy(bp, registry, editor.copy, h, editor.mirror).ok) this.tintGhost(0, GHOST_BAD);
      return;
    }
    const held = editor.held;
    if (!held || !registry.has(held.part)) return;
    // The part itself, and its mirror image when one would land: the same two a click places (or neither).
    const plain = placeHeld({ ...bp, parts: [] }, registry, held, h, editor.mirror, false);
    const spots = plain.ok ? plain.bp.parts : [{ part: held.part, x: h.x, y: h.y, rot: held.rot }];
    for (const s of spots) this.addPart(this.ghost, registry, s.part, s.x, s.y, s.rot, 0.55);
    const real = placeHeld(bp, registry, held, h, editor.mirror, false);
    if (real.ok) return;
    this.tintGhost(0, swap && placeHeld(bp, registry, held, h, editor.mirror, true).ok ? GHOST_SWAP : GHOST_BAD);
  }

  drawOverlay(o: Overlay, editor: EditorState, bp: Blueprint, registry: PartRegistry): void {
    this.mirror = { on: editor.mirror.on, axisHalfCells: editor.mirror.axisHalfCells };
    const g = this.overlay;
    g.clear();
    const px = 1 / this.cam.zoom;
    const cellRect = (c: Cell, inset = 0.04): void => {
      const tl = toScreen({ x: c.x - 0.5 + inset, y: c.y + 0.5 - inset });
      g.rect(tl.x, tl.y, (1 - 2 * inset) * PIXELS_PER_METER, (1 - 2 * inset) * PIXELS_PER_METER);
    };
    const cellsOf = (p: PlacedPart): Cell[] => (registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }]);
    const byId = new Map(bp.parts.map((p) => [p.id, p]));
    /** A dashed square round a cell: for what is likely, or missing, where a solid line says it is so. */
    const dashedCell = (c: Cell, inset: number): void => {
      const tl = toScreen({ x: c.x - 0.5 + inset, y: c.y + 0.5 - inset });
      const side = (1 - 2 * inset) * PIXELS_PER_METER;
      const n = 4;
      const step = side / (2 * n - 1);
      for (let i = 0; i < n; i++) {
        const a = i * 2 * step;
        g.moveTo(tl.x + a, tl.y).lineTo(tl.x + a + step, tl.y);
        g.moveTo(tl.x + a, tl.y + side).lineTo(tl.x + a + step, tl.y + side);
        g.moveTo(tl.x, tl.y + a).lineTo(tl.x, tl.y + a + step);
        g.moveTo(tl.x + side, tl.y + a).lineTo(tl.x + side, tl.y + a + step);
      }
    };

    if (o.pick) {
      // A slot being filled: what could fill it stays bright with a thin dashed frame, what is picked gets a solid one.
      const could = new Set(o.pick.could);
      const chosen = new Set(o.pick.chosen);
      let any = false;
      for (const p of bp.parts) {
        if (could.has(p.id) || chosen.has(p.id)) continue;
        for (const c of cellsOf(p)) cellRect(c, 0);
        any = true;
      }
      if (any) g.fill({ color: BUILDER_BG, alpha: 0.7 });
      let some = false;
      for (const p of bp.parts) {
        if (!could.has(p.id) || chosen.has(p.id)) continue;
        for (const c of cellsOf(p)) dashedCell(c, 0.07);
        some = true;
      }
      if (some) g.stroke({ color: PICK, width: 1.5, alpha: 0.8 });
      some = false;
      for (const p of bp.parts) {
        if (!chosen.has(p.id)) continue;
        for (const c of cellsOf(p)) cellRect(c, 0.04);
        some = true;
      }
      if (some) g.fill({ color: PICK, alpha: 0.24 }).stroke({ color: PICK, width: 3 });
    }

    if (o.reach && !o.pick) {
      // The script's parts stay bright and get a frame; the rest of the robot steps back.
      const lit = new Set([...o.reach.reached, ...o.reach.fits, ...o.reach.undriven]);
      let any = false;
      for (const p of bp.parts) {
        if (lit.has(p.id)) continue;
        for (const c of cellsOf(p)) cellRect(c, 0);
        any = true;
      }
      if (any) g.fill({ color: BUILDER_BG, alpha: 0.66 });
      const frame = (ids: readonly string[], draw: (c: Cell) => void): boolean => {
        let some = false;
        for (const id of ids) {
          const p = byId.get(id);
          if (!p) continue;
          for (const c of cellsOf(p)) draw(c);
          some = true;
        }
        return some;
      };
      if (frame(o.reach.reached, (c) => cellRect(c, 0.05))) g.fill({ color: REACH, alpha: 0.16 }).stroke({ color: REACH, width: 2.5 });
      if (frame(o.reach.fits, (c) => cellRect(c, 0.05))) g.fill({ color: REACH, alpha: 0.08 });
      if (frame(o.reach.fits, (c) => dashedCell(c, 0.05))) g.stroke({ color: REACH, width: 2.5 });
      if (frame(o.reach.undriven, (c) => dashedCell(c, 0.05))) g.stroke({ color: WARN, width: 3 });
    }

    for (const c of o.warningCells) cellRect(c);
    if (o.warningCells.length > 0) g.stroke({ color: WARN, width: 2 });
    for (const c of o.errorCells) cellRect(c);
    if (o.errorCells.length > 0) g.stroke({ color: BAD, width: 2 });

    // With an empty hand, the part a click would pick shows a thin frame.
    const hover = editor.hover;
    if (hover && !handFull(editor) && !editor.gesture) {
      const hit = partAt(bp, registry, hover.x, hover.y);
      if (hit && !o.selection.includes(hit.id)) {
        for (const c of cellsOf(hit)) cellRect(c, 0.01);
        g.stroke({ color: INK, width: Math.max(1, px), alpha: 0.55 });
      }
    }

    const moving = editor.gesture?.kind === 'move' && (editor.gesture.last.x !== editor.gesture.start.x || editor.gesture.last.y !== editor.gesture.start.y) ? editor.gesture : undefined;
    for (const id of o.selection) {
      const p = byId.get(id);
      // Every cell of a multi-cell part (M12).
      if (p) for (const c of cellsOf(p)) cellRect(c, 0.01);
    }
    if (o.selection.length > 0) g.stroke({ color: SELECT, width: 2, alpha: moving ? 0.35 : 1 });
    if (moving) {
      // Where the selection (and its mirror image, in mirror mode) would land, as outlines: red when it is blocked.
      const steps = moveSteps(bp, registry, moving.ids, moving.last.x - moving.start.x, moving.last.y - moving.start.y, editor.mirror);
      const ok = movePartsBy(bp, registry, steps).ok;
      for (const p of bp.parts) {
        const s = steps.get(p.id);
        if (s) for (const c of cellsOf(p)) cellRect({ x: c.x + s.dx, y: c.y + s.dy }, 0.01);
      }
      g.stroke({ color: ok ? SELECT : BAD, width: 2 });
    }
    if (o.box) {
      const minX = Math.min(o.box.a.x, o.box.b.x);
      const maxX = Math.max(o.box.a.x, o.box.b.x);
      const minY = Math.min(o.box.a.y, o.box.b.y);
      const maxY = Math.max(o.box.a.y, o.box.b.y);
      const tl = toScreen({ x: minX - 0.5, y: maxY + 0.5 });
      g.rect(tl.x, tl.y, (maxX - minX + 1) * PIXELS_PER_METER, (maxY - minY + 1) * PIXELS_PER_METER)
        .fill({ color: 0xffffff, alpha: 0.06 })
        .stroke({ color: SELECT, width: 1, alpha: 0.9 });
    }
    if (editor.eraser && hover) {
      // The eraser shows what it would clear (both sides in mirror mode): every cell of each part (M12).
      const hit = eraseTargets(bp, registry, hover, editor.mirror);
      if (hit.length === 0) cellRect(hover, 0.02);
      for (const p of hit) for (const c of cellsOf(p)) cellRect(c, 0.02);
      g.fill({ color: BAD, alpha: hit.length === 0 ? 0.08 : 0.2 }).stroke({ color: BAD, width: 2, alpha: hit.length === 0 ? 0.5 : 1 });
    }
    if (o.com) {
      const c = toScreen(o.com);
      const r = PIXELS_PER_METER * 0.22;
      g.circle(c.x, c.y, r).fill({ color: 0xe6e2d6, alpha: 0.92 }).stroke({ color: BUILDER_BG, width: 2 });
      g.moveTo(c.x - r, c.y).lineTo(c.x + r, c.y).moveTo(c.x, c.y - r).lineTo(c.x, c.y + r).stroke({ color: BUILDER_BG, width: 2 });
    }
  }

  /**
   * Puts a robot in the middle of the board, zoomed out as far as it takes to see all of it (never closer than the
   * usual zoom). `screen` is the canvas size. An empty robot puts cell (0, 0) in the middle.
   */
  show(bp: Blueprint, registry: PartRegistry, screen: { w: number; h: number }): void {
    const cells = bp.parts.flatMap((p) => (registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }]));
    if (cells.length === 0) {
      this.cam = { ...this.cam, x: 0, y: 0, zoom: 2 };
      return;
    }
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Room around it for the chips at the top and the hotbar at the bottom.
    const w = Math.max(200, screen.w - this.insets.left - this.insets.right - 80);
    const h = Math.max(200, screen.h - this.insets.top - this.insets.bottom - 170);
    const fit = Math.min(w / ((x1 - x0 + 1) * PIXELS_PER_METER), h / ((y1 - y0 + 1) * PIXELS_PER_METER));
    this.cam = { ...this.cam, x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.max(0.25, Math.min(2, fit)) };
  }

  /** Called every frame while the builder is visible. */
  frame(w: number, h: number): void {
    if (this.bgSize.w !== w || this.bgSize.h !== h) {
      this.bg.clear().rect(0, 0, w, h).fill(BUILDER_BG);
      this.bgSize = { w, h };
    }
    this.drawGrid(w, h);
    applyCamera(this.content, this.cam, w, h);
    this.content.position.x += this.offset.x;
    this.content.position.y += this.offset.y;
  }

  cellAt(sx: number, sy: number, w: number, h: number): Cell {
    const p = screenToWorld(this.cam, sx - this.offset.x, sy - this.offset.y, w, h);
    return { x: Math.floor(p.x + 0.5), y: Math.floor(p.y + 0.5) };
  }

  /** Where a cell's top right corner is on the canvas, in pixels: for a note about a part when the mouse is elsewhere. */
  pointOf(cell: Cell, w: number, h: number): { x: number; y: number } {
    const s = this.cam.zoom * PIXELS_PER_METER;
    return { x: w / 2 + this.offset.x + (cell.x + 0.5 - this.cam.x) * s, y: h / 2 + this.offset.y - (cell.y + 0.5 - this.cam.y) * s };
  }
}
