import { describe, expect, it } from 'vitest';
import type { Issue } from '@robots/sim-core';
import { deployDecision, snapDrop } from '../src/builder/deployFlow';

const err: Issue = { severity: 'error', code: 'UNATTACHED', message: 'x' };
const warn: Issue = { severity: 'warning', code: 'NO_CORE', message: 'y' };

describe('deployDecision', () => {
  it('errors block deploy', () => {
    expect(deployDecision([err, warn], false)).toEqual({ step: 'blocked', errors: 1 });
  });

  it('warnings alone do not block', () => {
    expect(deployDecision([warn], false)).toEqual({ step: 'place' });
  });

  it('unsaved changes ask first', () => {
    expect(deployDecision([], true)).toEqual({ step: 'confirm-unsaved' });
  });

  it('errors are reported before unsaved changes', () => {
    expect(deployDecision([err], true)).toEqual({ step: 'blocked', errors: 1 });
  });
});

describe('snapDrop', () => {
  it('snaps the cursor to 0.1 m', () => {
    expect(snapDrop({ x: 1.234, y: -0.049 })).toEqual({ x: 1.2, y: 0 });
  });
});
