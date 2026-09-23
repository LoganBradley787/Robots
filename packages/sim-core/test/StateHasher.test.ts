import { describe, expect, it } from 'vitest';
import { StateHasher } from '../src/replay/StateHasher';

describe('StateHasher', () => {
  it('starts at the FNV-1a offset basis', () => {
    expect(StateHasher.hex(new StateHasher().digest())).toBe('811c9dc5');
  });

  it('is deterministic for the same input', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    for (const v of [0, 1.5, -2.25, 1e-9]) { a.addF64(v); b.addF64(v); }
    a.addInt(600); b.addInt(600);
    expect(a.digest()).toBe(b.digest());
  });

  it('changes when a single float bit changes', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addF64(1.0);
    b.addF64(1.0 + Number.EPSILON);
    expect(a.digest()).not.toBe(b.digest());
  });

  it('hex is 8 lowercase hex digits', () => {
    const h = new StateHasher();
    h.addInt(123456);
    expect(StateHasher.hex(h.digest())).toMatch(/^[0-9a-f]{8}$/);
  });
});
