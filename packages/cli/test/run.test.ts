import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { runSim } from '../src/commands/run';
import { checkDeterminism } from '../src/commands/determinism';

const flat = parseWorldFile(flatJson);

describe('runSim', () => {
  it('samples once per second and reports the final box state', async () => {
    const r = await runSim(flat, { seconds: 2, seed: 1 });
    expect(r.ticks).toBe(120);
    expect(r.samples).toHaveLength(2);
    expect(r.samples[0]?.tick).toBe(60);
    expect(r.box.y).toBeLessThan(flat.spawn.y);
    expect(r.finalHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', async () => {
    const d = await checkDeterminism(flat, { seconds: 3, seed: 2 });
    expect(d.equal).toBe(true);
    expect(d.hashA).toBe(d.hashB);
  });
});
