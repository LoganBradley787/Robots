import { describe, expect, it } from 'vitest';
import { keyProblem } from '../src/control/keys';
import { validateBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';
import { parseKeyTimeline } from '../src/control/timeline';

const reg = defaultRegistry();

describe('key names', () => {
  it('accepts letters, digits, and key codes', () => {
    for (const k of ['d', '1', 'ArrowUp', 'ShiftLeft', 'Enter']) expect(keyProblem(k), k).toBeUndefined();
  });

  it('explains keys that can never fire', () => {
    expect(keyProblem('D')).toContain("should be written 'd'");
    expect(keyProblem('KeyD')).toContain("should be written 'd'");
    expect(keyProblem('Digit4')).toContain("should be written '4'");
    expect(keyProblem('Space')).toContain('belongs to the world');
    expect(keyProblem(',')).toContain('not a key name');
  });

  it('the validator and the timeline refuse them', () => {
    const bp = { format: 1, name: 'c', grid: ['F  C  F', 'W  .  W'], bindings: [{ key: 'D', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }] };
    const v = validateBlueprint(bp, reg);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('BAD_KEY');
    expect(() => parseKeyTimeline('Space:0-1')).toThrow('belongs to the world');
  });

  it('a part id that is a part type name is refused', () => {
    const v = validateBlueprint({ format: 1, name: 'p', parts: [{ part: 'core', x: 0, y: 1 }, { id: 'wheel', part: 'wheel', x: 0, y: 0 }] }, reg);
    expect(v.issues.find((i) => i.code === 'BAD_ID')?.message).toContain("pick another id, like 'left-wheel'");
  });
});
