import { describe, expect, it } from 'vitest';
import { BURN_BROWN, BURN_STEPS, burnStep, unburntSide } from '../src/render/burnRing';

/** WCAG relative luminance of a 0xrrggbb color. */
function luminance(color: number): number {
  const ch = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(((color >> 16) & 255) / 255) + 0.7152 * ch(((color >> 8) & 255) / 255) + 0.0722 * ch((color & 255) / 255);
}
const contrast = (a: number, b: number): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
// The world's background (`Renderer`).
const WORLD = 0x141a22;

describe('burnRing', () => {
  it('shows all brown only at 1', () => {
    expect(burnStep(0)).toBe(0);
    expect(burnStep(1)).toBe(BURN_STEPS);
    expect(burnStep(0.999)).toBe(BURN_STEPS - 1);
    expect(burnStep(2)).toBe(BURN_STEPS);
    expect(unburntSide(BURN_STEPS)).toBe(0);
  });

  it('brown stands clear of the world behind it: a burnt battery must not read as a gap', () => {
    expect(contrast(BURN_BROWN, WORLD)).toBeGreaterThanOrEqual(4);
    const [r, g, b] = [(BURN_BROWN >> 16) & 255, (BURN_BROWN >> 8) & 255, BURN_BROWN & 255];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('the brown covers the burnt share of the part: what is left is the rest', () => {
    for (let step = 0; step <= BURN_STEPS; step++) expect(unburntSide(step) ** 2).toBeCloseTo(1 - step / BURN_STEPS, 12);
  });
});
