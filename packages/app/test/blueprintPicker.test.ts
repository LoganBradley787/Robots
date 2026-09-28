import { describe, expect, it } from 'vitest';
import { groupOf, matches } from '../src/ui/BlueprintPicker';

describe('blueprint picker', () => {
  it('groups blueprints by file name', () => {
    expect(groupOf('enemy-fab-drone.json')).toBe('Enemies');
    expect(groupOf('missile-up.json')).toBe('Missiles and bombs');
    expect(groupOf('heavy-drone-bomb.json')).toBe('Missiles and bombs');
    expect(groupOf('bomb.json')).toBe('Missiles and bombs');
    expect(groupOf('flare-rack.json')).toBe('Pieces and targets');
    expect(groupOf('wall.json')).toBe('Pieces and targets');
    expect(groupOf('gun-drone.json')).toBe('Yours');
    expect(groupOf('walker.json')).toBe('Yours');
  });

  it('matches every typed word in any order', () => {
    const f = { file: 'enemy-fab-gun-drone.json', name: 'enemy-fab-gun-drone' };
    expect(matches(f, 'gun fab')).toBe(true);
    expect(matches(f, 'GUN')).toBe(true);
    expect(matches(f, 'gun walker')).toBe(false);
    expect(matches(f, '')).toBe(true);
  });
});
