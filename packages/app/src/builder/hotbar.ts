/**
 * The hotbar (M16): nine slots on the keys 1 to 9. The player fills it by dragging tiles onto it and it never changes
 * by itself. It starts as the first nine parts of the registry and is kept in the browser, not in a blueprint.
 */
export type Hotbar = Array<string | null>;

export const HOTBAR_SLOTS = 9;
export const HOTBAR_KEY = 'robots.hotbar';
export const RECENT_KEY = 'robots.recentParts';
/** How many parts the drawer's recent row holds: one row of tiles. */
export const RECENT_SHOWN = 3;

/** The first nine parts, in registry order; empty slots when there are fewer. */
export function defaultHotbar(partIds: readonly string[]): Hotbar {
  return Array.from({ length: HOTBAR_SLOTS }, (_, i) => partIds[i] ?? null);
}

/**
 * The hotbar as it was saved, or the default when nothing readable was saved. A slot naming a part that no longer
 * exists comes back empty: it is not refilled, because the hotbar never changes by itself.
 */
export function readHotbar(text: string | null | undefined, partIds: readonly string[]): Hotbar {
  if (text === null || text === undefined) return defaultHotbar(partIds);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultHotbar(partIds);
  }
  if (!Array.isArray(raw)) return defaultHotbar(partIds);
  return Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
    const v: unknown = raw[i];
    return typeof v === 'string' && partIds.includes(v) ? v : null;
  });
}

/** Puts a part on a slot (null empties it). The same hotbar comes back when nothing changes or the slot does not exist. */
export function setSlot(hotbar: Hotbar, slot: number, part: string | null): Hotbar {
  if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS || hotbar[slot] === part) return hotbar;
  return hotbar.map((p, i) => (i === slot ? part : p));
}

/** Two slots trade places (dragging one slot onto another). */
export function swapSlots(hotbar: Hotbar, a: number, b: number): Hotbar {
  const ok = (n: number): boolean => Number.isInteger(n) && n >= 0 && n < HOTBAR_SLOTS;
  if (!ok(a) || !ok(b) || a === b) return hotbar;
  return hotbar.map((p, i) => (i === a ? (hotbar[b] ?? null) : i === b ? (hotbar[a] ?? null) : p));
}

/** The key that picks a part ("1" to "9"), or undefined when it is not on the hotbar. The first slot wins. */
export function hotbarKey(hotbar: Hotbar, part: string): string | undefined {
  const i = hotbar.indexOf(part);
  return i >= 0 ? String(i + 1) : undefined;
}

/**
 * The recent row after a part was taken in hand: newest first, no repeats. A part already in the row stays where it
 * is, so taking one from the row never shuffles the row under the cursor.
 */
export function pushRecent(recent: readonly string[], part: string): string[] {
  if (recent.slice(0, RECENT_SHOWN).includes(part)) return recent as string[];
  return [part, ...recent.filter((p) => p !== part)].slice(0, RECENT_SHOWN);
}

export function readRecent(text: string | null | undefined, partIds: readonly string[]): string[] {
  try {
    const raw: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && partIds.includes(v)).slice(0, RECENT_SHOWN) : [];
  } catch {
    return [];
  }
}
