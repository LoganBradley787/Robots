import { describe, expect, it } from 'vitest';
import { autoBindings, allBindings } from '../src/control/autoControls';
import { expandBlueprint } from '../src/blueprint/expand';
import { defaultRegistry } from '../src/parts/registry';
import { setAutoControls, setPartsAuto } from '../src/blueprint/edit';
import { toFileJson } from '../src/blueprint/serialize';
import type { Blueprint } from '../src/blueprint/types';

const registry = defaultRegistry();
function bp(raw: unknown): Blueprint {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}
const keysFor = (b: Blueprint, id: string): string[] => autoBindings(b, registry).filter((x) => x.target === id).map((x) => `${x.key}${x.value}`);

describe('auto controls', () => {
  it('wheels get D +1 and A -1 whatever their rotation', () => {
    const b = bp({ format: 1, name: 'c', grid: ['W<  F  C  F  W>', '.   W  .  W^ .'] });
    for (const id of ['wheel@0,1', 'wheel@4,1', 'wheel@1,0', 'wheel@3,0']) expect(keysFor(b, id)).toEqual(['d1', 'a-1']);
  });

  it('thrusters and propellers get the key for the way they push', () => {
    const b = bp({ format: 1, name: 't', grid: ['.   Tv  .', 'T>  C   T<', '.   T^  .', '.   P   .'], legend: { P: { part: 'propeller', rot: 180 } } });
    expect(keysFor(b, 'thruster@1,3')).toEqual(['s1']);
    expect(keysFor(b, 'thruster@0,2')).toEqual(['d1']);
    expect(keysFor(b, 'thruster@2,2')).toEqual(['a1']);
    expect(keysFor(b, 'thruster@1,1')).toEqual(['w1']);
    expect(keysFor(b, 'propeller@1,0')).toEqual(['s1']);
  });

  it('parts without autoControl get nothing', () => {
    const b = bp({ format: 1, name: 'f', grid: ['F  C  B  X'] });
    expect(autoBindings(b, registry)).toEqual([]);
  });

  it('31 of 32 wheels on auto: one part opts out', () => {
    const row = Array.from({ length: 32 }, () => 'F').join(' ');
    const wheels = Array.from({ length: 32 }, () => 'W').join(' ');
    let b = bp({ format: 1, name: 'long', grid: [row.replace(/^F/, 'C'), wheels] });
    b = setPartsAuto(b, ['wheel@5,0'], false);
    const targets = new Set(autoBindings(b, registry).map((x) => x.target));
    expect(targets.size).toBe(31);
    expect(targets.has('wheel@5,0')).toBe(false);
    expect(setPartsAuto(b, ['wheel@5,0'], true).parts.find((p) => p.id === 'wheel@5,0')).not.toHaveProperty('auto');
  });

  it('autoControls false turns them all off', () => {
    const b = setAutoControls(bp({ format: 1, name: 'c', grid: ['F  C  F', 'W  .  W'] }), false);
    expect(autoBindings(b, registry)).toEqual([]);
    expect(setAutoControls(b, true)).not.toHaveProperty('autoControls');
  });

  it('auto bindings come before custom ones', () => {
    const b = bp({ format: 1, name: 'c', grid: ['F  C  F', 'W  .  W'], bindings: [{ key: 'k', mode: 'hold', target: 'wheel', channel: 'speed', value: -1 }] });
    expect(allBindings(b, registry).map((x) => x.key)).toEqual(['d', 'a', 'd', 'a', 'k']);
  });

  it('opt-outs survive a save in both file forms', () => {
    const grid = setAutoControls(setPartsAuto(bp({ format: 1, name: 'c', grid: ['F  C  F', 'W  .  W'] }), ['wheel@2,0'], false), false);
    const gridFile = toFileJson(grid, registry);
    expect(gridFile.autoControls).toBe(false);
    expect(bp(gridFile).parts.find((p) => p.id === 'wheel@2,0')?.auto).toBe(false);
    expect(bp(gridFile).parts.find((p) => p.id === 'wheel@0,0')).not.toHaveProperty('auto');
    const parts = bp({ format: 1, name: 'p', parts: [{ part: 'core', x: 0, y: 1 }, { part: 'wheel', x: -1, y: 0, auto: false }, { part: 'frame', x: -1, y: 1 }] });
    const partsFile = toFileJson(parts, registry);
    expect(bp(partsFile).parts.find((p) => p.part === 'wheel')?.auto).toBe(false);
  });

  it('rejects non-boolean auto flags', () => {
    expect(expandBlueprint({ format: 1, name: 'x', grid: ['C'], autoControls: 'no' }).issues[0]?.code).toBe('BAD_FORMAT');
    expect(expandBlueprint({ format: 1, name: 'x', parts: [{ part: 'core', x: 0, y: 0, auto: 1 }] }).issues[0]?.code).toBe('BAD_FORMAT');
  });
});
