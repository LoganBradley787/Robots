/**
 * Asset names the renderer uses. Part frame names are not listed here: they come from each part def's
 * `sprite` spec, so adding a part never touches this file. `test/assetKeys.test.ts` checks that every
 * name here and in the defs exists in `public/assets`, so a missing texture is a red build.
 */

/** Animations in the fx sheet. */
export const FX_ANIMATIONS = { propeller: 'fx.propeller', flame: 'fx.flame' } as const;

/** Standalone terrain tile aliases in the asset manifest. */
export const TERRAIN = { ground: 'terrain.ground', groundTop: 'terrain.groundTop', block: 'terrain.block' } as const;

/** Every sprite frame is one grid cell of this many texture pixels. */
export const TEXTURE_PX_PER_CELL = 64;
