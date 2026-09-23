import { describe, expect, it } from 'vitest';
import { codeOf } from '../src/app/keys';

describe('codeOf', () => {
  it('prefers the physical code', () => {
    expect(codeOf({ code: 'KeyD', key: 'x' })).toBe('KeyD');
  });

  it('falls back to the key when code is empty', () => {
    expect(codeOf({ code: '', key: '.' })).toBe('Period');
    expect(codeOf({ code: '', key: ' ' })).toBe('Space');
    expect(codeOf({ code: '', key: 'd' })).toBe('KeyD');
    expect(codeOf({ code: '', key: 'Shift' })).toBe('');
  });
});
