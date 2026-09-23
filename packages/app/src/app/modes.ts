export type Mode = 'builder' | 'world';

export interface ModeState {
  mode: Mode;
  /** The world's paused flag. */
  paused: boolean;
  /** What `paused` was when the builder opened, restored on the way back. */
  pausedBeforeBuilder: boolean;
}

/** The world never runs while the builder is open. */
export function enterBuilder(s: ModeState): ModeState {
  if (s.mode === 'builder') return s;
  return { mode: 'builder', paused: true, pausedBeforeBuilder: s.paused };
}

export function enterWorld(s: ModeState): ModeState {
  if (s.mode === 'world') return s;
  return { mode: 'world', paused: s.pausedBeforeBuilder, pausedBeforeBuilder: s.pausedBeforeBuilder };
}

export function toggleMode(s: ModeState): ModeState {
  return s.mode === 'builder' ? enterWorld(s) : enterBuilder(s);
}
