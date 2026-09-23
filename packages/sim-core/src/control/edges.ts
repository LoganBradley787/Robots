import type { RobotInput } from './types';

/**
 * Appends one key edge to a tick's inputs, keeping order. The controller applies an entry's presses before its
 * releases, so an edge for a key that the current entry already has starts a new entry: release then press again
 * stays held, and two taps of a toggle flip it twice.
 */
export function appendEdge(entries: RobotInput[], robot: number, key: string, kind: 'press' | 'release'): void {
  let last = entries[entries.length - 1];
  if (!last || last.robot !== robot || last.pressed.includes(key) || last.released.includes(key)) {
    last = { robot, pressed: [], released: [] };
    entries.push(last);
  }
  (kind === 'press' ? last.pressed : last.released).push(key);
}
