import { describe, expect, it } from 'vitest';
import { breakNotice } from '../src/world/breakNotice';

describe('breakNotice', () => {
  it('speaks up when most of a robot left its core behind', () => {
    expect(breakNotice('titan-mirage-r', 9, 1053)).toBe('titan-mirage-r broke apart: its core kept 9 parts, the other 1053 went off with nobody driving them');
    expect(breakNotice('drone', 1, 4)).toBe('drone broke apart: its core kept 1 part, the other 4 went off with nobody driving them');
  });

  it('says nothing of a robot that keeps the most of itself', () => {
    expect(breakNotice('titan-mirage-r', 1200, 3)).toBeUndefined();
    expect(breakNotice('drone', 4, 4)).toBeUndefined();
  });
});
