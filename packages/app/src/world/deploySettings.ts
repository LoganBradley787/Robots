import type { Rotation } from '@robots/sim-core';

/**
 * How the next robot is deployed (M8, Logan): its team, and whether it is flipped left to right and turned. All three
 * stick until changed, across deploys and reloads, so placing five enemies facing left is five clicks.
 */
export interface DeploySettings {
  /** 0 is yours, 1 the enemy. A number so more teams can come later. */
  team: number;
  flip: boolean;
  rot: Rotation;
}

export const DEFAULT_DEPLOY: DeploySettings = { team: 0, flip: false, rot: 0 };

/** Teams the toolbar cycles through. */
export const DEPLOY_TEAMS = 2;

const STORAGE_KEY = 'robots.deploy';

export function nextTeam(s: DeploySettings): DeploySettings {
  return { ...s, team: (s.team + 1) % DEPLOY_TEAMS };
}

export function flipped(s: DeploySettings): DeploySettings {
  return { ...s, flip: !s.flip };
}

/** A quarter turn counterclockwise, like the builder's R. */
export function turned(s: DeploySettings): DeploySettings {
  return { ...s, rot: ((s.rot + 90) % 360) as Rotation };
}

export function teamName(team: number): string {
  return team === 0 ? 'Yours' : team === 1 ? 'Enemy' : `Team ${team}`;
}

/** The part of `Storage` this needs, so tests pass a plain object. */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The saved settings, or the defaults when there are none, they are malformed, or storage is blocked. */
export function loadDeploySettings(store: SettingsStore | undefined): DeploySettings {
  try {
    const text = store?.getItem(STORAGE_KEY);
    if (!text) return DEFAULT_DEPLOY;
    const o = JSON.parse(text) as Record<string, unknown>;
    const team = typeof o.team === 'number' && Number.isInteger(o.team) && o.team >= 0 && o.team < DEPLOY_TEAMS ? o.team : 0;
    const rot = o.rot === 90 || o.rot === 180 || o.rot === 270 ? o.rot : 0;
    return { team, flip: o.flip === true, rot };
  } catch {
    return DEFAULT_DEPLOY;
  }
}

export function saveDeploySettings(store: SettingsStore | undefined, s: DeploySettings): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Blocked storage (a private window): the settings still hold for this session.
  }
}
