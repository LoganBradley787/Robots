import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { footprintOf, mirrorable, mirroredShift, mirrorRotation, partCells, mirrorX, partAt, rotationRadians, type Blueprint, type PartRegistry, type Rotation } from '@robots/sim-core';
import { applyCamera } from '../render/cameraView';
import { createCamera, screenToWorld, type CameraState } from '../render/camera';
import { partSprites } from '../render/partSprites';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from '../render/units';
import type { Cell, EditorState } from './editorState';
import { stampGhost } from './stamp';

export const BUILDER_BG = 0x13203a;
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

  constructor(root: Container, frame: (name: string) => Texture) {
    this.texture = frame;
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
    const levels: Array<{ keep: (i: number) => boolean; alpha: number }> = [
      { keep: (i) => i % 5 !== 0, alpha: 0.07 },
      { keep: (i) => i % 5 === 0, alpha: 0.16 },
    ];
    for (const { keep, alpha } of levels) {
      for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
        if (!keep(i)) continue;
        line(i - 0.5, -GRID_EXTENT, i - 0.5, GRID_EXTENT);
        line(-GRID_EXTENT, i - 0.5, GRID_EXTENT, i - 0.5);
      }
      g.stroke({ color: 0x9fb4d8, alpha, pixelLine: true });
    }
    return g;
  }

  private sprite(name: string, x: number, y: number, rot: Rotation, alpha = 1, t: { x: number; y: number; w: number; h: number; flip?: boolean } = { x: 0, y: 0, w: 1, h: 1 }): Sprite {
    const s = new Sprite(this.texture(name));
    s.anchor.set(0.5);
    // A multi-cell part (M12) spans its footprint's box (or its tiles), turned with it.
    s.width = PIXELS_PER_METER * t.w;
    s.height = PIXELS_PER_METER * t.h;
    if (t.flip) s.scale.x *= -1;
    const p = toScreen({ x: x + t.x, y: y + t.y });
    s.position.set(p.x, p.y);
    s.rotation = toScreenAngle(rotationRadians(rot));
    s.alpha = alpha;
    return s;
  }

  private addPart(into: Container, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation, alpha = 1, armed = false, size?: [number, number]): void {
    if (!registry.has(part)) return;
    const def = registry.get(part);
    const spec = def.sprite;
    // A part set to start armed (M10) shows its armed frame.
    for (const t of partSprites(def, rot, footprintOf(def, size), armed && spec.armedFrame ? spec.armedFrame : spec.frame)) into.addChild(this.sprite(t.frame, x, y, rot, alpha, t));
    if (spec.mountFrame) into.addChild(this.sprite(spec.mountFrame, x, y, rot, alpha));
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
    if (o.warningCells.length > 0) g.stroke({ color: 0xffb347, width: 2 });
    for (const c of o.errorCells) cellRect(c);
    if (o.errorCells.length > 0) g.stroke({ color: 0xff4d4d, width: 2 });
    for (const id of o.selection) {
      const p = bp.parts.find((q) => q.id === id);
      // Every cell of a multi-cell part (M12).
      if (p) for (const c of registry.has(p.part) ? partCells(p, registry) : [{ cell: p }]) cellRect(c.cell, 0.01);
    }
    if (o.selection.length > 0) g.stroke({ color: 0x6fd3ff, width: 2 });
    if (o.box) {
      const minX = Math.min(o.box.a.x, o.box.b.x);
      const maxX = Math.max(o.box.a.x, o.box.b.x);
      const minY = Math.min(o.box.a.y, o.box.b.y);
      const maxY = Math.max(o.box.a.y, o.box.b.y);
      const tl = toScreen({ x: minX - 0.5, y: maxY + 0.5 });
      g.rect(tl.x, tl.y, (maxX - minX + 1) * PIXELS_PER_METER, (maxY - minY + 1) * PIXELS_PER_METER)
        .fill({ color: 0x6fd3ff, alpha: 0.08 })
        .stroke({ color: 0x6fd3ff, width: 1, alpha: 0.8 });
    }
    if (editor.eraser && editor.hover) {
      // The eraser shows the cells it would clear (both sides in mirror mode).
      const mx = mirrorX(editor.hover.x, editor.mirror.axisHalfCells);
      for (const x of editor.mirror.on && mx !== editor.hover.x ? [editor.hover.x, mx] : [editor.hover.x]) {
        // The whole part under the cursor, every cell of it (M12).
        const hit = partAt(bp, registry, x, editor.hover.y);
        for (const c of hit && registry.has(hit.part) ? partCells(hit, registry) : [{ cell: { x, y: editor.hover.y } }]) cellRect(c.cell, 0.02);
      }
      g.fill({ color: 0xff4d4d, alpha: 0.18 }).stroke({ color: 0xff7a7a, width: 2 });
    }
    if (editor.mirror.on) {
      const ax = editor.mirror.axisHalfCells / 2;
      for (let y = -GRID_EXTENT; y < GRID_EXTENT; y += 0.5) {
        const a = toScreen({ x: ax, y });
        const b = toScreen({ x: ax, y: y + 0.25 });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ color: 0xc792ea, width: 2, alpha: 0.9 });
    }
    if (o.com) {
      const c = toScreen(o.com);
      const r = PIXELS_PER_METER * 0.22;
      g.circle(c.x, c.y, r).fill({ color: 0xffffff, alpha: 0.9 }).stroke({ color: 0x13203a, width: 2 });
      g.moveTo(c.x - r, c.y).lineTo(c.x + r, c.y).moveTo(c.x, c.y - r).lineTo(c.x, c.y + r).stroke({ color: 0x13203a, width: 2 });
    }
    void registry;
  }

  /** Called every frame while the builder is visible. */
  frame(w: number, h: number): void {
    if (this.bgSize.w !== w || this.bgSize.h !== h) {
      this.bg.clear().rect(0, 0, w, h).fill(BUILDER_BG);
      this.bgSize = { w, h };
    }
    applyCamera(this.content, this.cam, w, h);
  }

  cellAt(sx: number, sy: number, w: number, h: number): Cell {
    const p = screenToWorld(this.cam, sx, sy, w, h);
    return { x: Math.floor(p.x + 0.5), y: Math.floor(p.y + 0.5) };
  }
}
