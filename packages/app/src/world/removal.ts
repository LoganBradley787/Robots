import type { SettingsStore } from './deploySettings';

/**
 * Removing robots by hand (M16, Logan: a long fight leaves the world slow, and Clear debris keeps every robot that
 * still has a core). The screen picks the robots, by a click, a distance or a team; the world only takes the ids
 * (`World.removeRobots`), so a replay removes the same ones.
 */

/** The distances Remove far away offers, in meters from the middle of the world. */
export const FAR_DISTANCES = [250, 500, 1000] as const;
export const DEFAULT_FAR = 500;

const FAR_KEY = 'robots.removeFar';

/** Where a robot is for Remove far away: its core, or the middle of a piece with none. */
export interface RobotSpot {
  id: number;
  x: number;
  y: number;
}

/** Robots farther than `distance` from the middle of the world (x 0 on the ground), however they got there. */
export function farIds(spots: readonly RobotSpot[], distance: number): number[] {
  return spots.filter((s) => Math.hypot(s.x, s.y) > distance).map((s) => s.id);
}

/** A team's robots, the pieces that broke off them included: a piece keeps the team of what it came off. */
export function teamIds(robots: readonly { id: number; team: number }[], team: number): number[] {
  return robots.filter((r) => r.team === team).map((r) => r.id);
}

/** How many robots each team has, lowest team first, teams with none left out. */
export function teamCounts(robots: readonly { team: number }[]): { team: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const r of robots) counts.set(r.team, (counts.get(r.team) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([team, count]) => ({ team, count }));
}

/** "1 robot", "3 robots". */
export function robotsText(n: number): string {
  return `${n} ${n === 1 ? 'robot' : 'robots'}`;
}

/** The saved distance for Remove far away, or the default when there is none or it is not one of the choices. */
export function loadFarDistance(store: SettingsStore | undefined): number {
  try {
    const v = Number(store?.getItem(FAR_KEY));
    return (FAR_DISTANCES as readonly number[]).includes(v) ? v : DEFAULT_FAR;
  } catch {
    return DEFAULT_FAR;
  }
}

export function saveFarDistance(store: SettingsStore | undefined, distance: number): void {
  try {
    store?.setItem(FAR_KEY, String(distance));
  } catch {
    // Blocked storage: the choice still holds for this session.
  }
}

/** One edge of an outline, in a body's frame (meters). */
export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The outline of a set of whole cells (centers on integers): every cell side with no cell beyond it. Cells of one
 * body, so a robot of many bodies is outlined body by body.
 */
export function outlineEdges(cells: readonly { x: number; y: number }[]): Edge[] {
  const has = new Set(cells.map((c) => `${c.x},${c.y}`));
  const out: Edge[] = [];
  for (const k of has) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (!has.has(`${x},${y + 1}`)) out.push({ x1: x - 0.5, y1: y + 0.5, x2: x + 0.5, y2: y + 0.5 });
    if (!has.has(`${x},${y - 1}`)) out.push({ x1: x - 0.5, y1: y - 0.5, x2: x + 0.5, y2: y - 0.5 });
    if (!has.has(`${x + 1},${y}`)) out.push({ x1: x + 0.5, y1: y - 0.5, x2: x + 0.5, y2: y + 0.5 });
    if (!has.has(`${x - 1},${y}`)) out.push({ x1: x - 0.5, y1: y - 0.5, x2: x - 0.5, y2: y + 0.5 });
  }
  return out;
}
