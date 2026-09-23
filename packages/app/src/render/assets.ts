import { Assets, TextureStyle, type Spritesheet, type Texture } from 'pixi.js';

export interface GameTextures {
  /** A frame from the parts sheet, by name (the names part defs use). */
  part(frame: string): Texture;
  /** A standalone texture by manifest alias (terrain tiles). */
  alias(name: string): Texture;
  fx: Spritesheet;
}

/** Loads the manifest bundles once. Frame names are the contract; real art is a file swap. */
export async function loadTextures(): Promise<GameTextures> {
  // 64 px art drawn at 32 px per meter: linear filtering keeps 2x downscales and zooms clean.
  TextureStyle.defaultOptions.scaleMode = 'linear';
  const base = `${import.meta.env.BASE_URL}assets`;
  const manifest: unknown = await (await fetch(`${base}/manifest.json`)).json();
  await Assets.init({ manifest: manifest as never, basePath: base });
  const loaded = (await Assets.loadBundle(['parts', 'fx', 'terrain'])) as Record<string, Record<string, unknown>>;
  const parts = loaded.parts?.parts as Spritesheet | undefined;
  const fx = loaded.fx?.fx as Spritesheet | undefined;
  if (!parts || !fx) throw new Error('asset bundles parts and fx must each contain a spritesheet');
  const terrain = loaded.terrain ?? {};
  return {
    part(frame) {
      const t = parts.textures[frame];
      if (!t) throw new Error(`parts sheet has no frame "${frame}"`);
      return t;
    },
    alias(name) {
      const t = terrain[name] as Texture | undefined;
      if (!t) throw new Error(`no texture with alias "${name}"`);
      return t;
    },
    fx,
  };
}
