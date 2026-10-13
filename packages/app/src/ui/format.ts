/** 42 s, 3 min 30 s. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

/** A number with no more decimals than it needs: 3, 0.5, 1.25. */
export function num(v: number, digits = 2): string {
  return String(Number(v.toFixed(digits)));
}

/** The name of the key that goes with Z, S and D for undo, save and copy: Cmd on a Mac, Ctrl elsewhere. */
export const MOD: string = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? 'Cmd' : 'Ctrl';
