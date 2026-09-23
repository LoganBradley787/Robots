import { DEFAULT_LEGEND } from './legend';
import type { Blueprint, LegendEntry } from './types';

/**
 * Renders a blueprint as grid rows plus a legend. Parts that match a default token (same part and rotation, only
 * the implicit id tag) use it; others get generated lowercase tokens with explicit legend entries.
 * Assumes no overlaps (validate first). Ids that are not the default `part@x,y` do not survive the trip.
 */
export function toGrid(bp: Blueprint): { grid: string[]; legend: Record<string, LegendEntry> } {
  if (bp.parts.length === 0) return { grid: [], legend: {} };
  const defaults = Object.entries(DEFAULT_LEGEND);
  const legend: Record<string, LegendEntry> = {};
  const generated = new Map<string, string>();
  let nextToken = 0;
  const cells = new Map<string, string>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of bp.parts) {
    const extraTags = p.tags.filter((t) => t !== p.id);
    let token: string | undefined;
    if (extraTags.length === 0) {
      token = defaults.find(([, e]) => e.part === p.part && (e.rot ?? 0) === p.rot)?.[0];
    }
    if (!token) {
      const key = JSON.stringify([p.part, p.rot, extraTags]);
      token = generated.get(key);
      if (!token) {
        token = tokenName(nextToken++);
        generated.set(key, token);
        const entry: LegendEntry = { part: p.part, rot: p.rot };
        if (extraTags.length > 0) entry.tags = extraTags;
        legend[token] = entry;
      }
    }
    cells.set(`${p.x},${p.y}`, token);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const width = Math.max(1, ...[...cells.values()].map((t) => t.length));
  const grid: string[] = [];
  for (let y = maxY; y >= minY; y--) {
    const row: string[] = [];
    for (let x = minX; x <= maxX; x++) row.push((cells.get(`${x},${y}`) ?? '.').padEnd(width));
    grid.push(row.join(' ').trimEnd());
  }
  return { grid, legend };
}

function tokenName(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return i < letters.length ? (letters[i] ?? 'a') : `p${i}`;
}
