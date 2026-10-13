import { Container, Sprite, type Renderer, type Texture } from 'pixi.js';
import { footprintOf, rotationRadians, type Blueprint, type PartRegistry, type Rotation } from '@robots/sim-core';
import { partSprites } from './partSprites';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

type Frame = (name: string) => Texture;

function sprite(texture: Frame, name: string, x: number, y: number, rot: Rotation, alpha: number, t: { x: number; y: number; w: number; h: number; flip?: boolean } = { x: 0, y: 0, w: 1, h: 1 }): Sprite {
  const s = new Sprite(texture(name));
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

/** One part as the builder draws it, standing still: its sprite or tiles, and its mount. Unknown parts draw nothing. */
export function addPartSprites(into: Container, texture: Frame, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation, alpha = 1, armed = false, size?: [number, number]): void {
  if (!registry.has(part)) return;
  const def = registry.get(part);
  const spec = def.sprite;
  // A part set to start armed (M10) shows its armed frame.
  for (const t of partSprites(def, rot, footprintOf(def, size), armed && spec.armedFrame ? spec.armedFrame : spec.frame)) into.addChild(sprite(texture, t.frame, x, y, rot, alpha, t));
  if (spec.mountFrame) into.addChild(sprite(texture, spec.mountFrame, x, y, rot, alpha));
}

/**
 * A small picture of a whole robot (M16: the library's cards and the Assemblies rows), drawn from the same sprites as
 * the board and scaled to fit `maxW` by `maxH` pixels. A PNG data URL, or undefined for a robot with nothing to draw.
 */
export async function robotThumbnail(renderer: Renderer, texture: Frame, bp: Blueprint, registry: PartRegistry, maxW: number, maxH: number): Promise<string | undefined> {
  const robot = new Container();
  for (const p of bp.parts) addPartSprites(robot, texture, registry, p.part, p.x, p.y, p.rot, 1, p.armed === true, p.size);
  const frame = new Container();
  frame.addChild(robot);
  try {
    if (robot.children.length === 0) return undefined;
    const b = robot.getLocalBounds();
    if (b.width <= 0 || b.height <= 0) return undefined;
    // Never blown up past two screen pixels a sprite pixel: a one-part robot stays a small, sharp picture.
    robot.scale.set(Math.min(maxW / b.width, maxH / b.height, 2));
    return await renderer.extract.base64({ target: frame, resolution: 1 });
  } finally {
    frame.destroy({ children: true });
  }
}
