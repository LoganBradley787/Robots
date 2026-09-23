import { describe, expect, it } from 'vitest';
import { SIM_CORE_VERSION } from '../src/index';

describe('sim-core package', () => {
  it('exports a version', () => {
    expect(SIM_CORE_VERSION).toBe('0.0.0');
  });
});
