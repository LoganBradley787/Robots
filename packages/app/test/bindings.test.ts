import { describe, expect, it } from 'vitest';
import { defaultRegistry, expandBlueprint, type Blueprint } from '@robots/sim-core';
import { autoLabel, autoSummary, bindingTargets, channelsForTarget, defaultBinding, keyName, percent, typeLabel } from '../src/builder/bindings';
import { setAutoControls, setPartsAuto } from '@robots/sim-core';

const reg = defaultRegistry();
const bp = expandBlueprint({
  format: 1,
  name: 't',
  grid: ['P C P', 'W F W'],
  legend: { P: { part: 'propeller', tags: ['props'] }, W: { part: 'wheel', tags: ['wheels'] } },
}).blueprint as Blueprint;

describe('binding helpers', () => {
  it('targets list part types, explicit tags, then parts that have inputs', () => {
    expect(bindingTargets(bp, reg)).toEqual({
      types: ['propeller', 'wheel'],
      tags: ['props', 'wheels'],
      parts: ['propeller@0,1', 'propeller@2,1', 'wheel@0,0', 'wheel@2,0'],
    });
    expect(typeLabel(reg, 'wheel')).toBe('all wheels');
    expect(channelsForTarget(bp, reg, 'wheel')).toEqual([{ name: 'speed', min: -1, max: 1, default: 0 }]);
  });

  it('channels for a target are the inputs of its parts', () => {
    expect(channelsForTarget(bp, reg, 'wheels')).toEqual([{ name: 'speed', min: -1, max: 1, default: 0 }]);
    expect(channelsForTarget(bp, reg, 'props')).toEqual([{ name: 'throttle', min: 0, max: 1, default: 0 }]);
    expect(channelsForTarget(bp, reg, 'nothing')).toEqual([]);
  });

  it('a default binding targets the first tag and its first channel at full value, on a key auto controls leave free', () => {
    // Auto controls use D and A (wheels) and W (the propellers push up).
    expect(defaultBinding(bp, reg)).toEqual({ key: 's', mode: 'hold', target: 'props', channel: 'throttle', value: 1 });
    const off = setAutoControls(bp, false);
    expect(defaultBinding(off, reg).key).toBe('d');
    const withD = { ...off, bindings: [{ key: 'd', mode: 'hold' as const, target: 'props', channel: 'throttle', value: 1 }] };
    expect(defaultBinding(withD, reg).key).toBe('a');
  });

  it('summarizes auto controls by key, grouped by part type and direction', () => {
    expect(autoSummary(bp, reg)).toEqual([
      { key: 'W', text: '2 propellers' },
      { key: 'A', text: '2 wheels reverse' },
      { key: 'D', text: '2 wheels forward' },
    ]);
    const one = setPartsAuto(bp, ['wheel@0,0'], false);
    expect(autoSummary(one, reg).find((l) => l.key === 'D')?.text).toBe('1 wheel forward');
  });

  it('labels what auto controls give one part', () => {
    const part = (id: string) => bp.parts.find((p) => p.id === id)!;
    expect(autoLabel(reg, part('wheel@0,0'))).toBe('D forward, A reverse');
    expect(autoLabel(reg, part('propeller@0,1'))).toBe('W (pushes up)');
    expect(autoLabel(reg, part('core@1,1'))).toBeUndefined();
  });

  it('shows values as percent', () => {
    expect(percent(1)).toBe('+100%');
    expect(percent(-0.5)).toBe('-50%');
    expect(percent(0)).toBe('0%');
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
    expect(bindingTargets(framed, reg)).toEqual({ types: [], tags: [], parts: [] });
  });
});
