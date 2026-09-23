import { Container, TilingSprite, type Texture } from 'pixi.js';
import type { WorldFile } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

export interface TerrainTextures {
  ground: Texture;
  groundTop: Texture;
  block: Texture;
}

const VISUAL_DEPTH_M = 40;

function tiled(texture: Texture, widthM: number, heightM: number): TilingSprite {
  const t = new TilingSprite({ texture, width: widthM * PIXELS_PER_METER, height: heightM * PIXELS_PER_METER });
  // One texture tile per 1 m cell, whatever the art resolution.
  t.tileScale.set(PIXELS_PER_METER / texture.width, PIXELS_PER_METER / texture.height);
  return t;
}

/** Static ground and static boxes as tiled sprites. Dynamic world boxes are not drawn yet (none exist). */
export function buildTerrainView(file: WorldFile, tex: TerrainTextures): Container {
  const root = new Container();
  const w = file.ground.width;
  const top = tiled(tex.groundTop, w, 1);
  // Drawn deeper than the physics slab so the world reads as solid earth, not a floating plank.
  const fill = tiled(tex.ground, w, Math.max(VISUAL_DEPTH_M, file.ground.thickness) - 1);
  const left = toScreen({ x: -w / 2, y: 0 });
  top.position.set(left.x, left.y);
  fill.position.set(left.x, left.y + PIXELS_PER_METER);
  root.addChild(fill, top);
  for (const b of file.boxes) {
    if (b.dynamic) continue;
    const s = tiled(tex.block, b.w, b.h);
    s.anchor.set(0.5);
    const p = toScreen(b);
    s.position.set(p.x, p.y);
    s.rotation = toScreenAngle((b.angleDeg * Math.PI) / 180);
    root.addChild(s);
  }
  return root;
}
