import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { PartRegistry, defaultRegistry } from '../src/parts/registry';
import { parsePartDef } from '../src/parts/parsePartDef';
import { footprintBox, mirrorable } from '../src/parts/footprint';
import { validateBlueprint } from '../src/blueprint/validate';
import { orientRaw } from '../src/blueprint/orient';

const flat = parseWorldFile(flatJson);
/** A U three wide and three tall, open at the top: the hollow is (0, 1) and (0, 2). */
const U = {
  id: 'cup',
  name: 'Cup',
  footprint: [
    { x: 0, y: 0, faces: ['S'], grips: ['N'] },
    { x: -1, y: 0, faces: ['S', 'W'] },
    { x: 1, y: 0, faces: ['S', 'E'] },
    { x: -1, y: 1, faces: ['W'], grips: ['E'] },
    { x: -1, y: 2, faces: ['W', 'N'], grips: ['E'] },
    { x: 1, y: 1, faces: ['E'], grips: ['W'] },
    { x: 1, y: 2, faces: ['E', 'N'], grips: ['W'] },
  ],
  mass: 7,
  health: 100,
  symmetry: 4,
  inputs: [],
  outputs: [],
  powerDraw: 0,
  sprite: { frame: 'part.cup' },
};
const L = { ...U, id: 'ell', footprint: [{ x: 0, y: 0, faces: ['S'] }, { x: 1, y: 0, faces: ['E'] }, { x: 0, y: 1, faces: ['N'] }] };
const registry = new PartRegistry([...defaultRegistry().list(), parsePartDef(U, 'cup.json'), parsePartDef(L, 'ell.json')]);

describe('multi-cell parts (M12)', () => {
  it('parse: grips, and no cell twice or a face both ways', () => {
    const cup = registry.get('cup');
    expect(cup.footprint[3]).toEqual({ x: -1, y: 1, faces: ['W'], grips: ['E'] });
    expect(() => parsePartDef({ ...U, footprint: [...U.footprint, { x: 1, y: 1, faces: ['E'] }] }, 'x.json')).toThrow('listed twice');
    expect(() => parsePartDef({ ...U, footprint: [{ x: 0, y: 0, faces: ['S'], grips: ['S'] }] }, 'x.json')).toThrow('either a face or a grip');
  });

  it('its sprite box spans the footprint', () => {
    expect(footprintBox(registry.get('cup'))).toEqual({ cx: 0, cy: 1, w: 3, h: 3 });
    expect(footprintBox(registry.get('core'))).toEqual({ cx: 0, cy: 0, w: 1, h: 1 });
  });

  it('mirroring: a footprint symmetric about its origin column mirrors, any other is refused', () => {
    expect(mirrorable(registry.get('cup'))).toBe(true);
    expect(mirrorable(registry.get('ell'))).toBe(false);
    for (const d of defaultRegistry().list()) expect(mirrorable(d)).toBe(true);
    const cupBot = { format: 1, name: 'cup-bot', parts: [{ part: 'core', x: 0, y: -1 }, { part: 'cup', x: 0, y: 0 }] };
    const ellBot = { format: 1, name: 'ell-bot', parts: [{ part: 'core', x: 0, y: -1 }, { part: 'ell', x: 0, y: 0 }] };
    expect(() => orientRaw(cupBot, { flip: true }, registry)).not.toThrow();
    expect(() => orientRaw(ellBot, { flip: true }, registry)).toThrow(/ell.*cannot be mirrored/);
  });

  it('parts may sit in its hollow; there they attach only through what the hollow offers', () => {
    const v = validateBlueprint({ format: 1, name: 'x', parts: [{ part: 'core', x: 0, y: -1 }, { part: 'cup', x: 0, y: 0 }, { part: 'frame', x: 0, y: 1 }] }, registry);
    expect(v.issues.filter((i) => i.code === 'OVERLAP')).toEqual([]);
  });

  it('a blast reaches it at its nearest cell, not only its origin', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, flat, registry);
    const r = w.spawnBlueprint({ format: 1, name: 'cup-bot', parts: [{ part: 'core', x: 0, y: -1 }, { part: 'cup', x: 0, y: 0 }] }, { x: -100, y: 30 });
    // The core is at (-100, 30), so the cup's origin is at (-100, 31) and its right wall's top cell at (-99, 33). A bomb
    // 1.8 m above that cell is 3.9 m from the origin, beyond the warhead's 3 m.
    w.spawnBlueprint({ format: 1, name: 'b', grid: ['X'], legend: { X: { part: 'warhead', armed: true } } }, { x: -99, y: 34.8 });
    const bomb = w.robots[1];
    const x = bomb?.parts.get('warhead@0,0');
    if (x) x.health = 0;
    w.step();
    const cup = r.parts.get('cup@0,0');
    expect(cup?.health).toBeLessThan(100);
    w.dispose();
  });
});
