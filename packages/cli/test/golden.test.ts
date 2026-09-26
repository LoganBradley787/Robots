import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SCENES, runScene } from '../src/scenes';

/**
 * M9: final state hashes recorded before the script speedup, so a change that should not change the sim can prove it
 * did not. After a change to the sim on purpose, rewrite them with `UPDATE_GOLDEN=1 pnpm test` and say why in the
 * commit.
 */
const FILE = fileURLToPath(new URL('./golden-hashes.json', import.meta.url));
const update = process.env.UPDATE_GOLDEN === '1';
const recorded: Record<string, string> = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>) : {};

describe('golden hashes', () => {
  const found: Record<string, string> = {};
  for (const scene of GOLDEN_SCENES) {
    it(`${scene.name} ends in the recorded state`, { timeout: 120_000 }, async () => {
      const r = await runScene(scene);
      found[scene.name] = r.finalHash;
      if (update) {
        writeFileSync(FILE, `${JSON.stringify({ ...recorded, ...found }, null, 2)}\n`);
        return;
      }
      expect(r.finalHash, `${scene.name}: run UPDATE_GOLDEN=1 pnpm test only if the sim was changed on purpose`).toBe(recorded[scene.name]);
    });
  }
});
