import { describe, expect, it } from 'vitest';
import { multiplyTint, teamTint } from '../src/render/teamTint';

describe('team tint (M8)', () => {
  it('leaves your robots alone and tints enemies', () => {
    expect(teamTint(0)).toBe(0xffffff);
    expect(teamTint(1)).not.toBe(0xffffff);
    expect(teamTint(5)).toBe(teamTint(1));
  });

  it('multiplies with the damage tint channel by channel', () => {
    expect(multiplyTint(0xffffff, 0x123456)).toBe(0x123456);
    expect(multiplyTint(0x808080, 0x808080)).toBe(0x404040);
  });
});
