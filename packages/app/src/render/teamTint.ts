/**
 * Tint for a robot's team (M8): yours are drawn as they are, the enemy reddish, further teams in other colors, so the
 * sides can be told apart at a glance.
 */
export function teamTint(team: number): number {
  if (team === 0) return 0xffffff;
  const tints = [0xff8a80, 0x8ac4ff, 0x9dff9a, 0xffe07a];
  return tints[(team - 1) % tints.length] ?? 0xffffff;
}

/** Two tints combined the way a GPU tint multiplies colors: channel by channel. */
export function multiplyTint(a: number, b: number): number {
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  const m = (s: number): number => Math.round((ch(a, s) * ch(b, s)) / 255);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
