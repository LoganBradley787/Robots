import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { formatReport, InvalidBlueprint, runSim } from '../src/commands/run';
import { checkDeterminism } from '../src/commands/determinism';
import { validateCommand } from '../src/commands/validate';
import { showBlueprint } from '../src/commands/show';
import { listBlueprints, resolveBlueprint } from '../src/blueprintFiles';

const flat = parseWorldFile(flatJson);

describe('runSim', () => {
  it('samples the car once per second and ends at rest', async () => {
    const r = await runSim(flat, carJson, { seconds: 3, seed: 1, at: { x: 0, y: 3 } });
    expect(r.ticks).toBe(180);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[0]?.tick).toBe(60);
    expect(r.final.resting).toBe(true);
    expect(Math.abs(r.final.coreY - 1.45)).toBeLessThan(0.02);
    expect(r.finalHash).toMatch(/^[0-9a-f]{8}$/);
    expect(formatReport(r)).toContain('final: ticks=180');
  });

  it('refuses an invalid blueprint with its issues', async () => {
    await expect(runSim(flat, { format: 1, name: 'x', grid: ['C . F'] }, { seconds: 1, seed: 1 })).rejects.toBeInstanceOf(InvalidBlueprint);
  });

  it('is deterministic', async () => {
    const d = await checkDeterminism(flat, carJson, { seconds: 3, seed: 2 });
    expect(d.equal).toBe(true);
  });
});

describe('validate and show', () => {
  it('validate reports ok or issues', () => {
    expect(validateCommand(carJson)).toMatchObject({ ok: true, text: 'ok' });
    const bad = validateCommand({ format: 1, name: 'x', grid: ['C . F'] });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toEqual(['UNATTACHED']);
  });

  it('show prints the grid, mass, and body structure', () => {
    const shown = showBlueprint(carJson);
    expect(shown.ok).toBe(true);
    const text = shown.text;
    expect(text).toContain('car: 8 parts');
    expect(text).toContain('F F C B F F');
    expect(text).toContain('mass: 12.000 kg');
    expect(text).toContain('group 1: 1 part origin wheel@0,0 joint -> group 0');
    expect(showBlueprint({ format: 1, name: 'x', grid: ['C . F'] }).ok).toBe(false);
  });
});

describe('blueprint files', () => {
  it('resolves names in blueprints/', () => {
    expect(resolveBlueprint('car')).toMatch(/blueprints\/car\.json$/);
    expect(listBlueprints()).toContain('showcase');
    expect(() => resolveBlueprint('nope')).toThrow("no blueprint named 'nope'");
  });
});
