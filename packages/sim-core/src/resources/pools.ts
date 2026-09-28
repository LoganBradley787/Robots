/** A part that holds a resource: its id, what it holds now, and its capacity. */
export interface Container {
  id: string;
  stored: number;
  capacity: number;
}

/** A chunk's pool of one resource: the sum over its containers (`05`: pools are derived, not stored). */
export function poolTotals(containers: readonly Container[]): { stored: number; capacity: number } {
  let stored = 0;
  let capacity = 0;
  for (const c of [...containers].sort(byId)) {
    stored += c.stored;
    capacity += c.capacity;
  }
  return { stored, capacity };
}

/**
 * The fraction of every request a pool can grant this tick: 1 when it covers them all, else `stored / requested`
 * for everyone alike (proportional brownout, so the result never depends on part order).
 */
export function grantFactor(stored: number, requested: number): number {
  if (requested <= 0) return 1;
  if (stored <= 0) return 0;
  return stored >= requested ? 1 : stored / requested;
}

/**
 * Takes `amount` from the containers in proportion to what each holds, so they empty together. Works in part id
 * order so float sums come out the same everywhere. Mutates `stored`; returns what was actually taken.
 */
export function drainContainers(containers: readonly Container[], amount: number): number {
  const sorted = [...containers].sort(byId);
  const total = sorted.reduce((s, c) => s + c.stored, 0);
  if (amount <= 0 || total <= 0) return 0;
  if (amount >= total) {
    for (const c of sorted) c.stored = 0;
    return total;
  }
  let taken = 0;
  for (const c of sorted) {
    const share = Math.min(c.stored, (amount * c.stored) / total);
    c.stored -= share;
    taken += share;
  }
  return taken;
}

/**
 * Batch: the reverse of draining. Adds `amount` to the containers in proportion to the room each has left, so they
 * fill together and none passes its capacity. Works in part id order so float sums come out the same everywhere.
 * Mutates `stored`; returns what was actually added (less than `amount` when the pool is nearly full).
 */
export function fillContainers(containers: readonly Container[], amount: number): number {
  const sorted = [...containers].sort(byId);
  const room = sorted.reduce((s, c) => s + Math.max(0, c.capacity - c.stored), 0);
  if (amount <= 0 || room <= 0) return 0;
  if (amount >= room) {
    for (const c of sorted) c.stored = Math.max(c.stored, c.capacity);
    return room;
  }
  let added = 0;
  for (const c of sorted) {
    const free = Math.max(0, c.capacity - c.stored);
    const share = Math.min(free, (amount * free) / room);
    c.stored = Math.min(c.capacity, c.stored + share);
    added += share;
  }
  return added;
}

function byId(a: Container, b: Container): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
