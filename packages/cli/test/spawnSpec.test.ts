import { describe, expect, it } from 'vitest';
import { parseSpawnSuffixes, parseTeam } from '../src/spawnSpec';

describe('deploy team and facing (M8)', () => {
  it('reads teams by name or number', () => {
    expect(parseTeam('enemy')).toBe(1);
    expect(parseTeam('Yours')).toBe(0);
    expect(parseTeam('3')).toBe(3);
    expect(() => parseTeam('red')).toThrow('yours, enemy, or a team number');
  });

  it('reads drop suffixes in any order', () => {
    expect(parseSpawnSuffixes([], 'd')).toEqual({ team: 0 });
    expect(parseSpawnSuffixes(['enemy', 'flip'], 'd')).toEqual({ team: 1, flip: true });
    expect(parseSpawnSuffixes(['rot270', 'team2'], 'd')).toEqual({ team: 2, rot: 270 });
    expect(() => parseSpawnSuffixes(['rot45'], '--drop x')).toThrow("--drop x: 'rot45' is not");
    expect(() => parseSpawnSuffixes(['sideways'], '--drop x')).toThrow('flip');
  });
});
