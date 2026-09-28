import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';

const car = { format: 1, name: 'car', grid: ['F  F  C  B  F  F', 'W  .  .  .  .  W'] };

const codes = (raw: unknown): string[] => expandBlueprint(raw).issues.map((i) => i.code);

describe('expandBlueprint', () => {
  it('expands the car grid in reading order with bottom row y = 0', () => {
    const { blueprint, issues } = expandBlueprint(car);
    expect(issues).toEqual([]);
    expect(blueprint?.parts.map((p) => p.id)).toEqual([
      'frame@0,1',
      'frame@1,1',
      'core@2,1',
      'battery@3,1',
      'frame@4,1',
      'frame@5,1',
      'wheel@0,0',
      'wheel@5,0',
    ]);
    expect(blueprint?.parts[6]).toEqual({ id: 'wheel@0,0', part: 'wheel', x: 0, y: 0, rot: 0, tags: ['wheel@0,0'] });
    expect(blueprint?.bindings).toEqual([]);
    expect(blueprint?.scripts).toEqual([]);
  });

  it('maps arrow tokens to rotations', () => {
    const { blueprint } = expandBlueprint({ format: 1, name: 't', grid: ['W< T> D< W> W^ T< Pv D>'] });
    expect(blueprint?.parts.map((p) => `${p.part}:${p.rot}`)).toEqual([
      'wheel:270',
      'thruster:270',
      'decoupler:90',
      'wheel:90',
      'wheel:180',
      'thruster:90',
      'propeller:180',
      'decoupler:270',
    ]);
  });

  it('merges a custom legend over the default and orders tags', () => {
    const { blueprint } = expandBlueprint({
      format: 1,
      name: 't',
      grid: ['F m'],
      legend: { F: { part: 'battery' }, m: { part: 'wheel', rot: 90, tags: ['wheels', 'left'] } },
    });
    expect(blueprint?.parts[0]?.part).toBe('battery');
    expect(blueprint?.parts[1]).toEqual({ id: 'wheel@1,0', part: 'wheel', x: 1, y: 0, rot: 90, tags: ['wheels', 'left', 'wheel@1,0'] });
  });

  it('accepts an explicit parts list with ids and tags', () => {
    const { blueprint, issues } = expandBlueprint({
      format: 1,
      name: 't',
      parts: [{ part: 'core', x: 0, y: 0 }, { id: 'w1', part: 'wheel', x: 0, y: -1, rot: 0, tags: ['wheels'] }],
    });
    expect(issues).toEqual([]);
    expect(blueprint?.parts[1]).toEqual({ id: 'w1', part: 'wheel', x: 0, y: -1, rot: 0, tags: ['wheels', 'w1'] });
  });

  it('reports an unknown token with its row, column, and cell', () => {
    const { issues } = expandBlueprint({ format: 1, name: 't', grid: ['F F', 'F @'] });
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'UNKNOWN_TOKEN',
        message: "grid token '@' at row 1 column 1 is not in the legend",
        cell: { x: 1, y: 0 },
      },
    ]);
  });

  it('rejects bad top-level shapes', () => {
    expect(codes({ format: 1, name: 't', grid: ['F'], parts: [] })).toEqual(['BAD_FORMAT']);
    expect(codes({ format: 1, name: 't' })).toEqual(['BAD_FORMAT']);
    expect(codes({ format: 2, name: 't', grid: ['F'] })).toEqual(['BAD_FORMAT']);
    expect(codes({ format: 1, name: 't', grid: ['F'], colour: 'red' })).toEqual(['BAD_FORMAT']);
    expect(expandBlueprint({ format: 1, name: 't', grid: ['F'], colour: 'red' }).issues[0]?.message).toContain(
      "unknown field 'colour'",
    );
    expect(codes('nope')).toEqual(['BAD_FORMAT']);
  });

  it('rejects a bad rotation in a parts list', () => {
    const { issues } = expandBlueprint({ format: 1, name: 't', parts: [{ part: 'frame', x: 0, y: 0, rot: 45 }] });
    expect(issues[0]?.code).toBe('BAD_ROTATION');
    expect(issues[0]?.path).toBe('parts[0].rot');
  });

  it('marks sub-assembly legend entries as unsupported for now', () => {
    const { issues } = expandBlueprint({ format: 1, name: 't', grid: ['m'], legend: { m: { blueprint: 'missile' } } });
    expect(issues[0]?.code).toBe('UNSUPPORTED');
  });

  it('shape-checks bindings and scripts', () => {
    const { issues } = expandBlueprint({
      format: 1,
      name: 't',
      grid: ['C'],
      bindings: [{ key: 'a', mode: 'wiggle' }],
      scripts: [{ id: 's', source: 42 }],
    });
    expect(issues.map((i) => i.code)).toEqual(['BAD_BINDING', 'BAD_SCRIPT']);
  });

  it('carries valid bindings and scripts through', () => {
    const { blueprint, issues } = expandBlueprint({
      format: 1,
      name: 't',
      grid: ['C'],
      bindings: [{ key: 'a', mode: 'hold', target: 'wheels', channel: 'speed', value: -1 }, { key: 'h', mode: 'script', script: 'hover' }],
      scripts: [{ id: 'hover', enabled: false, params: { kp: 0.6 }, source: { file: 'hover.js' } }],
    });
    expect(issues).toEqual([]);
    expect(blueprint?.bindings).toHaveLength(2);
    expect(blueprint?.scripts[0]).toEqual({ id: 'hover', enabled: false, params: { kp: 0.6 }, source: { file: 'hover.js' }, file: 'hover.js' });
  });

  it('legend lookups ignore object prototype names', () => {
    expect(expandBlueprint({ format: 1, name: 't', grid: ['toString'] }).issues[0]?.code).toBe('UNKNOWN_TOKEN');
    const raw = JSON.parse('{"format":1,"name":"t","grid":["__proto__"],"legend":{"__proto__":{"part":"frame"}}}');
    expect(expandBlueprint(raw).blueprint?.parts[0]?.part).toBe('frame');
  });

  it('keeps continuation cells for the validator', () => {
    const { blueprint } = expandBlueprint({ format: 1, name: 't', grid: ['F ='] });
    expect(blueprint?.continuations).toEqual([{ x: 1, y: 0 }]);
  });
});
