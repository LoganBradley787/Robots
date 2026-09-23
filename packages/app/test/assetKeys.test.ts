import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '@robots/sim-core';
import { FX_ANIMATIONS, TERRAIN, TEXTURE_PX_PER_CELL } from '../src/render/assetKeys';
import partsSheet from '../public/assets/sheets/parts.json';
import fxSheet from '../public/assets/sheets/fx.json';
import manifest from '../public/assets/manifest.json';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Sheet {
  frames: Record<string, { frame: Rect; sourceSize: { w: number; h: number } }>;
  animations?: Record<string, string[]>;
  meta: { image: string; size: { w: number; h: number } };
}

const parts: Sheet = partsSheet;
const fx: Sheet = fxSheet;
const aliases = manifest.bundles.flatMap((b) => b.assets.map((a) => a.alias));

describe('asset keys', () => {
  it('every part def sprite frame and mount frame is in the parts sheet', () => {
    for (const def of defaultRegistry().list()) {
      expect(parts.frames, `${def.id} sprite.frame`).toHaveProperty([def.sprite.frame]);
      if (def.sprite.mountFrame !== undefined) expect(parts.frames, `${def.id} sprite.mountFrame`).toHaveProperty([def.sprite.mountFrame]);
    }
  });

  it('every part def animation and overlay is an fx animation', () => {
    const anims = fx.animations ?? {};
    for (const def of defaultRegistry().list()) {
      if (def.sprite.animation !== undefined) expect(anims, `${def.id} sprite.animation`).toHaveProperty([def.sprite.animation]);
      if (def.sprite.overlay !== undefined) expect(anims, `${def.id} sprite.overlay`).toHaveProperty([def.sprite.overlay]);
    }
    for (const name of Object.values(FX_ANIMATIONS)) expect(anims).toHaveProperty([name]);
  });

  it('every fx animation frame exists in the fx sheet', () => {
    for (const [name, frames] of Object.entries(fx.animations ?? {})) {
      expect(frames.length, name).toBeGreaterThan(0);
      for (const f of frames) expect(fx.frames, `${name} -> ${f}`).toHaveProperty([f]);
    }
  });

  it('every terrain alias is in the manifest', () => {
    for (const alias of Object.values(TERRAIN)) expect(aliases).toContain(alias);
  });

  it('every frame is one cell and inside its sheet', () => {
    for (const sheet of [parts, fx]) {
      for (const [name, { frame, sourceSize }] of Object.entries(sheet.frames)) {
        expect([frame.w, frame.h, sourceSize.w, sourceSize.h], name).toEqual([
          TEXTURE_PX_PER_CELL,
          TEXTURE_PX_PER_CELL,
          TEXTURE_PX_PER_CELL,
          TEXTURE_PX_PER_CELL,
        ]);
        expect(frame.x, name).toBeGreaterThanOrEqual(0);
        expect(frame.y, name).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.w, name).toBeLessThanOrEqual(sheet.meta.size.w);
        expect(frame.y + frame.h, name).toBeLessThanOrEqual(sheet.meta.size.h);
      }
    }
  });
});
