import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { BodyState } from '../src/physics/PhysicsWorld';

const flat = parseWorldFile(flatJson);

async function run(seconds: number, seed: number): Promise<{ hash: string; box: BodyState }> {
  const w = await World.create({ seed }, flat);
  const box = w.spawnBox(flat.spawn.x + 0.3, flat.spawn.y);
  const ticks = Math.round(seconds / w.dt);
  for (let i = 0; i < ticks; i++) w.step();
  const out = { hash: w.hash(), box: w.physics.state(box) };
  w.dispose();
  return out;
}

describe('determinism', () => {
  it('two sequential runs are bit-identical', async () => {
    const a = await run(10, 1);
    const b = await run(10, 1);
    expect(a.hash).toBe(b.hash);
    expect(a.box).toEqual(b.box);
  });

  it('two interleaved worlds stay identical (no shared mutable state)', async () => {
    const a = await World.create({ seed: 1 }, flat);
    const b = await World.create({ seed: 1 }, flat);
    a.spawnBox(0.3, 6);
    b.spawnBox(0.3, 6);
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('the hash changes as the world evolves', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBox(0, 6);
    const h0 = w.hash();
    w.step();
    expect(w.hash()).not.toBe(h0);
    w.dispose();
  });

  it('matches the committed golden hash for 10 s of the flat world', async () => {
    // The snapshot file is committed. CI runs on Linux while development runs on macOS, so this test
    // also checks cross-platform determinism of the deterministic Rapier build. If it fails only in CI,
    // do not update the snapshot: record the finding in docs/status.md and docs/questions-pending.md.
    const a = await run(10, 1);
    expect(a.hash).toMatchSnapshot();
  });
});
