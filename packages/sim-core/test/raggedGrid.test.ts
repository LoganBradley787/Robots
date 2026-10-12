import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { toFileJson } from '../src/blueprint/serialize';
import { validateBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

describe('RAGGED_GRID and files the game writes', () => {
  it('never fires on a grid made by toFileJson, however lopsided the robot', () => {
    // An L of frames on one wheel, read from the long parts form so no row was written by hand.
    const parts = [
      { part: 'core', x: 0, y: 1 },
      { part: 'frame', x: 1, y: 1 },
      { part: 'frame', x: 2, y: 1 },
      { part: 'frame', x: 3, y: 1 },
      { part: 'frame', x: 0, y: 3 },
      { part: 'frame', x: 0, y: 2 },
      { part: 'wheel', x: 3, y: 0 },
    ];
    const bp = expandBlueprint({ format: 1, name: 'ell', parts }).blueprint;
    expect(bp).toBeDefined();
    if (!bp) return;
    const file = toFileJson(bp, reg) as { grid?: string[] };
    expect(file.grid).toBeDefined();
    expect(validateBlueprint(file, reg).issues.map((i) => i.code)).not.toContain('RAGGED_GRID');
  });
});
