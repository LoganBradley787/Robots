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
