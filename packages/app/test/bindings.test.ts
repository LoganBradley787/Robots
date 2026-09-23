import { describe, expect, it } from 'vitest';
import { defaultRegistry, expandBlueprint, type Blueprint } from '@robots/sim-core';
import { bindingTargets, channelsForTarget, defaultBinding, keyName } from '../src/builder/bindings';

const reg = defaultRegistry();
const bp = expandBlueprint({
  format: 1,
  name: 't',
  grid: ['P C P', 'W F W'],
  legend: { P: { part: 'propeller', tags: ['props'] }, W: { part: 'wheel', tags: ['wheels'] } },
}).blueprint as Blueprint;

describe('binding helpers', () => {
  it('targets list explicit tags first, then parts that have inputs', () => {
    expect(bindingTargets(bp, reg)).toEqual({ tags: ['props', 'wheels'], parts: ['propeller@0,1', 'propeller@2,1', 'wheel@0,0', 'wheel@2,0'] });
  });

  it('channels for a target are the inputs of its parts', () => {
    expect(channelsForTarget(bp, reg, 'wheels')).toEqual([{ name: 'speed', min: -1, max: 1, default: 0 }]);
    expect(channelsForTarget(bp, reg, 'props')).toEqual([{ name: 'throttle', min: 0, max: 1, default: 0 }]);
    expect(channelsForTarget(bp, reg, 'nothing')).toEqual([]);
  });

  it('a default binding targets the first tag and its first channel at full value', () => {
    expect(defaultBinding(bp, reg)).toEqual({ key: 'd', mode: 'hold', target: 'props', channel: 'throttle', value: 1 });
    const withD = { ...bp, bindings: [{ key: 'd', mode: 'hold' as const, target: 'props', channel: 'throttle', value: 1 }] };
    expect(defaultBinding(withD, reg).key).toBe('a');
  });

  it('a default binding without targets still has the shape', () => {
    const empty = expandBlueprint({ format: 1, name: 'e', grid: ['C'] }).blueprint as Blueprint;
    expect(defaultBinding(empty, reg)).toEqual({ key: 'd', mode: 'hold', target: '', channel: '', value: 1 });
  });

  it('keyName comes from the physical key, not the layout or Shift', () => {
    expect(keyName({ key: 'A', code: 'KeyA' })).toBe('a');
    expect(keyName({ key: '!', code: 'Digit1' })).toBe('1');
    expect(keyName({ key: 'q', code: 'KeyA' })).toBe('a');
    expect(keyName({ key: ' ', code: 'Space' })).toBe('Space');
    expect(keyName({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('ArrowUp');
  });

  it('tags on parts without inputs are not offered as targets', () => {
    const framed = expandBlueprint({ format: 1, name: 'f', grid: ['C F'], legend: { F: { part: 'frame', tags: ['body'] } } }).blueprint as Blueprint;
    expect(bindingTargets(framed, reg)).toEqual({ tags: [], parts: [] });
  });
});
