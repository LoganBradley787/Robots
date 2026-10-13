import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { mirrorable, mirroredShift, mirrorRotation, partCells, mirrorX, partAt, type Blueprint, type PartRegistry, type Rotation } from '@robots/sim-core';
import { applyCamera } from '../render/cameraView';
import { createCamera, screenToWorld, type CameraState } from '../render/camera';
import { addPartSprites } from '../render/partDraw';
import { PIXELS_PER_METER, toScreen } from '../render/units';
import type { Cell, EditorState } from './editorState';
import { stampGhost } from './stamp';

/**
 * The board's colours (M16, look: Shop floor). They repeat the tokens in `ui/styles.css` (--board, --grid,
 * --grid-major, --sel, --warn, --bad), because PixiJS draws the board and cannot read CSS.
 */
export const BUILDER_BG = 0x1b1e21;
const GRID = 0x2a2f34;
const GRID_MAJOR = 0x3a4047;
const SELECT = 0xf2b705;
const WARN = 0xe08a2e;
const BAD = 0xe5533c;
const GRID_EXTENT = 60;

export interface Overlay {
  /** Cells with validator errors and warnings. */
  errorCells: Cell[];
  warningCells: Cell[];
  /** Center of mass in cell coordinates, if there are parts. */
  com?: { x: number; y: number };
  selection: string[];
  /** Selection box corners while box selecting. */
  box?: { a: Cell; b: Cell };
}

/** Draws the builder: background, grid, parts, the held-part ghost, and overlays. Reads state, never edits it. */
export class BuilderScene {
  cam: CameraState = { ...createCamera(3, 2), zoom: 2 };
  private readonly bg = new Graphics();
  private readonly content = new Container();
  private readonly parts = new Container();
  private readonly ghost = new Container();
  private readonly overlay = new Graphics();
  private readonly texture: (name: string) => Texture;
  private bgSize = { w: 0, h: 0 };
  /** What the panels cover of the canvas, from each edge, in pixels: the board the player sees is what is left. */
  private readonly insets: { left: number; right: number; top: number; bottom: number };
  /** Where the middle of that board is, from the middle of the canvas. */
  private readonly offset: { x: number; y: number };

  constructor(root: Container, frame: (name: string) => Texture, insets: { left: number; right: number; top: number; bottom: number } = { left: 0, right: 0, top: 0, bottom: 0 }) {
    this.texture = frame;
    this.insets = insets;
    this.offset = { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
    this.content.addChild(this.buildGrid(), this.parts, this.overlay, this.ghost);
    root.addChild(this.bg, this.content);
  }

  private buildGrid(): Graphics {
    const g = new Graphics();
    const line = (ax: number, ay: number, bx: number, by: number): void => {
      const a = toScreen({ x: ax, y: ay });
      const b = toScreen({ x: bx, y: by });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    };
    // Lines sit on cell edges (half-integers), since parts sit on integer cell centers.
    const levels: Array<{ keep: (i: number) => boolean; color: number }> = [
      { keep: (i) => i % 5 !== 0, color: GRID },
      { keep: (i) => i % 5 === 0, color: GRID_MAJOR },
    ];
    for (const { keep, color } of levels) {
      for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
        if (!keep(i)) continue;
        line(i - 0.5, -GRID_EXTENT, i - 0.5, GRID_EXTENT);
        line(-GRID_EXTENT, i - 0.5, GRID_EXTENT, i - 0.5);
      }
      g.stroke({ color, pixelLine: true });
    }
    return g;
  }

  private addPart(into: Container, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation, alpha = 1, armed = false, size?: [number, number]): void {
    addPartSprites(into, this.texture, registry, part, x, y, rot, alpha, armed, size);
  }

  drawParts(bp: Blueprint, registry: PartRegistry): void {
    for (const c of this.parts.removeChildren()) c.destroy();
    for (const p of bp.parts) this.addPart(this.parts, registry, p.part, p.x, p.y, p.rot, 1, p.armed === true, p.size);
  }

  drawGhost(editor: EditorState, bp: Blueprint, registry: PartRegistry): void {
    for (const c of this.ghost.removeChildren()) c.destroy();
    const held = editor.held;
    const h = editor.hover;
    if (editor.stamp && h) {
      // A held blueprint: every part it would add, red where a click would be refused (an overlap).
      const g = stampGhost(bp, editor.stamp, h, editor.mirror, registry);
      for (const p of g.parts) this.addPart(this.ghost, registry, p.part, p.x, p.y, p.rot, 0.55, p.armed === true, p.size);
      if (!g.ok) for (const c of this.ghost.children) (c as Sprite).tint = 0xff7a7a;
      return;
    }
    if (!held || !h || editor.gesture?.kind === 'erase') return;
    const spots: Array<{ x: number; y: number; rot: Rotation }> = [{ x: h.x, y: h.y, rot: held.rot }];
    const mx = mirrorX(h.x, editor.mirror.axisHalfCells);
    if (editor.mirror.on && mx !== h.x && mirrorable(registry.get(held.part))) {
      const rot = mirrorRotation(held.rot);
      const shift = mirroredShift(registry.get(held.part).footprint, rot);
      spots.push({ x: mx + shift.x, y: h.y + shift.y, rot });
    }
    for (const s of spots) {
      const before = this.ghost.children.length;
      this.addPart(this.ghost, registry, held.part, s.x, s.y, s.rot, 0.55);
      // Red when it would replace another part in any of its cells (M12: a multi-cell part covers several).
      const cells = partCells({ id: '', part: held.part, x: s.x, y: s.y, rot: s.rot, tags: [] }, registry).map((c) => c.cell);
      const replaces = cells.some((c) => {
        const other = partAt(bp, registry, c.x, c.y);
        return other !== undefined && !(other.part === held.part && other.rot === s.rot && other.x === s.x && other.y === s.y);
      });
      if (replaces) for (const c of this.ghost.children.slice(before)) (c as Sprite).tint = 0xff7a7a;
    }
  }

  drawOverlay(o: Overlay, editor: EditorState, bp: Blueprint, registry: PartRegistry): void {
    const g = this.overlay;
    g.clear();
    const cellRect = (c: Cell, inset = 0.04): void => {
      const tl = toScreen({ x: c.x - 0.5 + inset, y: c.y + 0.5 - inset });
      g.rect(tl.x, tl.y, (1 - 2 * inset) * PIXELS_PER_METER, (1 - 2 * inset) * PIXELS_PER_METER);
    };
    for (const c of o.warningCells) cellRect(c);
    if (o.warningCells.length > 0) g.stroke({ color: WARN, width: 2 });
    for (const c of o.errorCells) cellRect(c);
    if (o.errorCells.length > 0) g.stroke({ color: BAD, width: 2 });
    for (const id of o.selection) {
      const p = bp.parts.find((q) => q.id === id);
      // Every cell of a multi-cell part (M12).
      if (p) for (const c of registry.has(p.part) ? partCells(p, registry) : [{ cell: p }]) cellRect(c.cell, 0.01);
    }
    if (o.selection.length > 0) g.stroke({ color: SELECT, width: 2 });
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
    if (editor.eraser && editor.hover) {
      // The eraser shows the cells it would clear (both sides in mirror mode).
      const mx = mirrorX(editor.hover.x, editor.mirror.axisHalfCells);
      for (const x of editor.mirror.on && mx !== editor.hover.x ? [editor.hover.x, mx] : [editor.hover.x]) {
        // The whole part under the cursor, every cell of it (M12).
        const hit = partAt(bp, registry, x, editor.hover.y);
        for (const c of hit && registry.has(hit.part) ? partCells(hit, registry) : [{ cell: { x, y: editor.hover.y } }]) cellRect(c.cell, 0.02);
      }
      g.fill({ color: BAD, alpha: 0.2 }).stroke({ color: BAD, width: 2 });
    }
    if (editor.mirror.on) {
      const ax = editor.mirror.axisHalfCells / 2;
      for (let y = -GRID_EXTENT; y < GRID_EXTENT; y += 0.5) {
        const a = toScreen({ x: ax, y });
        const b = toScreen({ x: ax, y: y + 0.25 });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ color: SELECT, width: 2, alpha: 0.9 });
    }
    if (o.com) {
      const c = toScreen(o.com);
      const r = PIXELS_PER_METER * 0.22;
      g.circle(c.x, c.y, r).fill({ color: 0xe6e2d6, alpha: 0.92 }).stroke({ color: BUILDER_BG, width: 2 });
      g.moveTo(c.x - r, c.y).lineTo(c.x + r, c.y).moveTo(c.x, c.y - r).lineTo(c.x, c.y + r).stroke({ color: BUILDER_BG, width: 2 });
    }
    void registry;
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
    applyCamera(this.content, this.cam, w, h);
    this.content.position.x += this.offset.x;
    this.content.position.y += this.offset.y;
  }

  cellAt(sx: number, sy: number, w: number, h: number): Cell {
    const p = screenToWorld(this.cam, sx - this.offset.x, sy - this.offset.y, w, h);
    return { x: Math.floor(p.x + 0.5), y: Math.floor(p.y + 0.5) };
  }
}
