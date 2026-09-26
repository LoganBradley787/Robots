import { Container, Sprite, type Texture } from 'pixi.js';
import { expandBlueprint, footprintOf, rootPartId, rotationRadians, type PartRegistry } from '@robots/sim-core';
import { partSprites } from '../render/partSprites';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from '../render/units';

const OK_TINT = 0x9dffb0;
const BLOCKED_TINT = 0xff7a7a;

/** A translucent copy of a blueprint that follows the cursor until it is dropped. Draw only; the world decides. */
export class SpawnGhost {
  readonly root = new Container();
  readonly raw: unknown;
  readonly name: string;

  constructor(raw: unknown, registry: PartRegistry, frame: (name: string) => Texture) {
    this.raw = raw;
    const bp = expandBlueprint(raw).blueprint;
    this.name = bp?.name ?? 'blueprint';
    const rootId = bp ? rootPartId(bp, registry) : undefined;
    const root = bp?.parts.find((p) => p.id === rootId);
    for (const p of bp?.parts ?? []) {
      if (!root || !registry.has(p.part)) continue;
      const def = registry.get(p.part);
      const spec = def.sprite;
      // A multi-cell part (M12) spans its footprint's box (or its tiles); a mount frame is one cell.
      const sprites = [...partSprites(def, p.rot, footprintOf(def, p.size), p.armed === true && spec.armedFrame ? spec.armedFrame : spec.frame), ...(spec.mountFrame ? [{ frame: spec.mountFrame, x: 0, y: 0, w: 1, h: 1, flip: false }] : [])];
      for (const t of sprites) {
        const s = new Sprite(frame(t.frame));
        s.anchor.set(0.5);
        s.width = PIXELS_PER_METER * t.w;
        s.height = PIXELS_PER_METER * t.h;
        if (t.flip) s.scale.x *= -1;
        const pos = toScreen({ x: p.x - root.x + t.x, y: p.y - root.y + t.y });
        s.position.set(pos.x, pos.y);
        s.rotation = toScreenAngle(rotationRadians(p.rot));
        this.root.addChild(s);
      }
    }
    this.root.alpha = 0.55;
  }

  /** Puts the root part (the primary core) at `at`, tinted by whether it can be dropped there. */
  place(at: { x: number; y: number }, ok: boolean): void {
    const p = toScreen(at);
    this.root.position.set(p.x, p.y);
    for (const c of this.root.children) (c as Sprite).tint = ok ? OK_TINT : BLOCKED_TINT;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
