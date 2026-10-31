/** Tint of a reactor at this heat (0 to 1): white when cold, red-hot at 1. */
export function heatTint(heat: number): number {
  const k = Math.max(0, Math.min(1, heat));
  const g = Math.round(255 - k * (255 - 70));
  const b = Math.round(255 - k * (255 - 30));
  return (255 << 16) | (g << 8) | b;
}

/**
 * Tint of a part with this fraction of its health left (M6): white when whole, darker and browner as it is hit.
 * At 0 the part is gone, so the darkest a part is ever drawn is just above that.
 */
export function damageTint(fraction: number): number {
  const k = 1 - Math.max(0, Math.min(1, fraction));
  const r = Math.round(255 - k * (255 - 110));
  const g = Math.round(255 - k * (255 - 84));
  const b = Math.round(255 - k * (255 - 70));
  return (r << 16) | (g << 8) | b;
}
