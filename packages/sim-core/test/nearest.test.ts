import { describe, expect, it } from 'vitest';
import { editDistance, nearestNames } from '../src/blueprint/nearest';

describe('editDistance', () => {
  it('counts a dropped, added, changed, or swapped letter as one', () => {
    expect(editDistance('seconds', 'seconds')).toBe(0);
    expect(editDistance('secnds', 'seconds')).toBe(1);
    expect(editDistance('secondss', 'seconds')).toBe(1);
    expect(editDistance('sead', 'seed')).toBe(1);
    expect(editDistance('sedc', 'secd')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('nearestNames', () => {
  const flags = ['world', 'seconds', 'seed', 'x', 'y', 'keys', 'json'];

  it('finds the likely typo', () => {
    expect(nearestNames('secnds', flags)).toEqual(['seconds']);
    expect(nearestNames('sead', flags)).toEqual(['seed']);
    expect(nearestNames('wheelz', ['wheel', 'frame', 'wheels'])).toEqual(['wheel']);
  });

  it('takes the start of a name as near', () => {
    expect(nearestNames('sec', flags)).toEqual(['seconds']);
  });

  it('says nothing when nothing is close', () => {
    expect(nearestNames('banana', flags)).toEqual([]);
    expect(nearestNames('z', flags)).toEqual([]);
    expect(nearestNames('seed', [])).toEqual([]);
  });

  it('gives the nearest first, ties in the order given, and at most as many as asked', () => {
    expect(nearestNames('titan-anvl', ['titan-hive', 'titan-anvil', 'titan-anvils', 'car'], 3)).toEqual(['titan-anvil', 'titan-anvils', 'titan-hive']);
    expect(nearestNames('gum', ['gun', 'gut', 'guy'], 2)).toEqual(['gun', 'gut']);
  });

  it('never offers the word itself', () => {
    expect(nearestNames('seed', ['seed', 'seeds'])).toEqual(['seeds']);
  });
});
