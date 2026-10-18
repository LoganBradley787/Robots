import { describe, expect, it } from 'vitest';
import { compareTickHashes, firstDifference, sceneReplay, tickHashes } from '../src/commands/hashes';

describe('pnpm sim hashes (M16)', () => {
  it('names the first tick two lists part at, counting from 1', () => {
    expect(firstDifference(['a', 'b'], ['a', 'b'])).toBeUndefined();
    expect(firstDifference(['a', 'b'], ['a', 'c'])).toBe(2);
    expect(firstDifference(['a'], ['a', 'b'])).toBe(2);
  });

  it('gives a hash for every tick of a scene, ending where the run that recorded it did', { timeout: 60_000 }, async () => {
    const replay = await sceneReplay('arena', 0.5);
    const here = await tickHashes(replay);
    expect(here.hashes).toHaveLength(30);
    expect(here.hashes.at(-1)).toBe(replay.endHash);
    expect(compareTickHashes(here, { ...here, runtime: 'elsewhere' }).same).toBe(true);
    const off = compareTickHashes(here, { ...here, runtime: 'elsewhere', hashes: [...here.hashes.slice(0, 9), 'x'] });
    expect(off.same).toBe(false);
    expect(off.text).toContain('from tick 10');
  });
});
