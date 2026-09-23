# Gate 1 (Look) punch list

Opened 2026-09-23 at tag `m1`. Logan: "Okay, this is not bad. This will do."

1. **Ground seam.** "After the first layer of tiles, there's a visible line ... a thin tan line." Cause: with linear filtering, the surface strip's bottom edge sampled the wrapped-around top row of its texture (the tan band). Fix: the earth fill overlaps the strip by 0.05 m and draws on top of it. Done.
2. **Ramp clipped into the ground.** "Is it supposed to be mounted into the ground? ... fine as long as it's stable." It is intentional and stable (a fixed body, set into the ground so robots can drive up it at Gate 3). Fix for the look: static blocks draw behind the ground so the buried part is hidden, and the ramp is lowered from y 0.6 to 0.45 so its top edge meets the ground flush instead of a 15 cm lip. Golden hashes updated (the ramp is world state). Done.

Textures: Logan may replace them later; for now they stay. Swapping art means replacing the PNGs and sheet JSON in `packages/app/public/assets/` (frame names are the contract, and `assetKeys.test.ts` fails the build if a frame is missing).

Gate 1 closed 2026-09-23 when the list was empty.
