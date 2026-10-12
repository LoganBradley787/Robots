import type { SettingsStore } from '../world/deploySettings';

/** The sound controls in the world toolbar (M15). They stick across reloads. */
export interface SoundSettings {
  muted: boolean;
  /** 0 to 1. */
  volume: number;
  /** Far sounds arrive late, at the speed of sound (Logan: a toggle to play with). */
  delay: boolean;
}

export const DEFAULT_SOUND: SoundSettings = { muted: false, volume: 0.7, delay: true };

const STORAGE_KEY = 'robots.sound';

/** The saved settings, or the defaults when there are none, they are malformed, or storage is blocked. */
export function loadSoundSettings(store: SettingsStore | undefined): SoundSettings {
  try {
    const text = store?.getItem(STORAGE_KEY);
    if (!text) return DEFAULT_SOUND;
    const o = JSON.parse(text) as Record<string, unknown>;
    return {
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_SOUND.muted,
      volume: typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 ? o.volume : DEFAULT_SOUND.volume,
      delay: typeof o.delay === 'boolean' ? o.delay : DEFAULT_SOUND.delay,
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function saveSoundSettings(store: SettingsStore | undefined, s: SoundSettings): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage is blocked or full: the settings just do not stick.
  }
}
