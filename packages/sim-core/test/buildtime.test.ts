import { describe, expect, it } from 'vitest';
import { buildSeconds, recipeStats } from '../src/fabricate/recipe';
import { validateBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef } from '../src/parts/parsePartDef';
import type { Blueprint } from '../src/blueprint/types';

const registry = defaultRegistry();
const recipe = (parts: string[]): Blueprint => {
  const v = validateBlueprint({ format: 1, name: 'r', parts: parts.map((part, i) => ({ part, x: i, y: 0 })) }, registry);
  return v.blueprint as Blueprint;
};

describe('build time per part (Batch)', () => {
  it('the def field is optional, positive, and read from the JSON', () => {
    const frame = registry.get('frame');
    expect(frame.build).toBe(0.2);
    const raw = JSON.parse(JSON.stringify(frame)) as Record<string, unknown>;
    expect(parsePartDef({ ...raw, build: 2 }, 'x.json').build).toBe(2);
    expect(parsePartDef({ ...raw, build: undefined }, 'x.json').build).toBeUndefined();
    expect(() => parsePartDef({ ...raw, build: 0 }, 'x.json')).toThrow(/build/);
    expect(() => parsePartDef({ ...raw, build: -1 }, 'x.json')).toThrow(/build/);
  });

  it('a recipe takes the sum of its parts, and the advanced ones are the slow ones', () => {
    const s = recipeStats(recipe(['core', 'booster', 'propeller']), registry);
    expect(s.built).toBeCloseTo(0.5 + 1.1 + 0.2, 9);
    expect(s.plainMass).toBe(0);
    expect(buildSeconds(s, 0.6)).toBeCloseTo(1.8, 9);
    const d = (id: string): number => registry.get(id).build ?? 0;
    expect(d('booster')).toBeGreaterThan(d('propeller'));
    expect(d('warhead')).toBeGreaterThan(d('propeller'));
    expect(d('radar')).toBeGreaterThan(d('seeker'));
    expect(d('densebattery')).toBeGreaterThan(d('battery'));
  });

  it('every shipped part but the bay names its own build time (integration: the batch parts too)', () => {
    const missing = registry.list().filter((d) => d.build === undefined).map((d) => d.id);
    expect(missing).toEqual(['fabbay']);
    const d = (id: string): number => registry.get(id).build ?? 0;
    expect(d('swivelthruster')).toBeGreaterThan(d('booster'));
    expect(d('armorplate')).toBeGreaterThan(d('frame'));
    expect(d('charge')).toBeGreaterThan(d('warhead'));
    expect(d('fin')).toBe(d('propeller'));
  });

  it("a part with no build time of its own is built at the bay's seconds per kg", () => {
    const v = validateBlueprint({ format: 1, name: 'r', parts: [{ part: 'core', x: 0, y: 0 }, { part: 'fabbay', x: 0, y: 1 }] }, registry);
    const s = recipeStats(v.blueprint as Blueprint, registry);
    expect(s.built).toBeCloseTo(0.5, 9);
    expect(s.plainMass).toBe(13);
    expect(buildSeconds(s, 0.6)).toBeCloseTo(0.5 + 0.6 * 13, 9);
  });

  it('the shipped recipes stay about as fast as before: missile-up about 4 s, heavy-drone-bomb 8 to 9 s', () => {
    const missile = recipeStats(recipe(['seeker', 'heavywarhead', 'core', 'heavygyro', 'booster']), registry);
    expect(buildSeconds(missile, 0.6)).toBeGreaterThan(3.8);
    expect(buildSeconds(missile, 0.6)).toBeLessThan(4.4);
    const bomb = recipeStats(recipe(['propeller', 'propeller', 'propeller', 'propeller', 'heavywarhead', 'heavywarhead', 'heavywarhead', 'heavywarhead', 'core', 'radar', 'gyro', 'cell']), registry);
    expect(buildSeconds(bomb, 0.6)).toBeGreaterThan(8);
    expect(buildSeconds(bomb, 0.6)).toBeLessThan(9);
  });
});
