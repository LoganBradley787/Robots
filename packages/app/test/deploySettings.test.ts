import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPLOY, flipped, loadDeploySettings, nextTeam, saveDeploySettings, teamName, turned, type SettingsStore } from '../src/world/deploySettings';
import { canPossess } from '../src/control/possession';

function memory(): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('deploy settings (M8)', () => {
  it('cycles teams, flips, and turns a quarter at a time', () => {
    expect(nextTeam(DEFAULT_DEPLOY).team).toBe(1);
    expect(nextTeam(nextTeam(DEFAULT_DEPLOY)).team).toBe(0);
    expect(flipped(DEFAULT_DEPLOY).flip).toBe(true);
    expect(flipped(flipped(DEFAULT_DEPLOY)).flip).toBe(false);
    let s = DEFAULT_DEPLOY;
    const rots: number[] = [];
    for (let i = 0; i < 4; i++) rots.push((s = turned(s)).rot);
    expect(rots).toEqual([90, 180, 270, 0]);
  });

  it('names teams', () => {
    expect(teamName(0)).toBe('Yours');
    expect(teamName(1)).toBe('Enemy');
    expect(teamName(3)).toBe('Team 3');
  });

  it('sticks across reloads', () => {
    const store = memory();
    expect(loadDeploySettings(store)).toEqual(DEFAULT_DEPLOY);
    saveDeploySettings(store, { team: 1, flip: true, rot: 270 });
    expect(loadDeploySettings(store)).toEqual({ team: 1, flip: true, rot: 270 });
  });

  it('falls back to the defaults on bad or blocked storage', () => {
    const store = memory();
    store.data.set('robots.deploy', '{not json');
    expect(loadDeploySettings(store)).toEqual(DEFAULT_DEPLOY);
    store.data.set('robots.deploy', JSON.stringify({ team: 9, flip: 'yes', rot: 45 }));
    expect(loadDeploySettings(store)).toEqual(DEFAULT_DEPLOY);
    const blocked: SettingsStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDeploySettings(blocked)).toEqual(DEFAULT_DEPLOY);
    expect(() => saveDeploySettings(blocked, DEFAULT_DEPLOY)).not.toThrow();
    expect(loadDeploySettings(undefined)).toEqual(DEFAULT_DEPLOY);
  });
});

describe('possession by team (M8)', () => {
  it('only your own controllable robots can be taken over', () => {
    expect(canPossess({ team: 0, controllable: true })).toBe(true);
    expect(canPossess({ team: 1, controllable: true })).toBe(false);
    expect(canPossess({ team: 0, controllable: false })).toBe(false);
  });
});
