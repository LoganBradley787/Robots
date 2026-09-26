import { partCells } from '../assembly/assemble';
import type { PartRegistry } from '../parts/registry';
import { partId } from './expand';
import { DEFAULT_LEGEND } from './legend';
import type { Blueprint, LegendEntry } from './types';

export interface GridForm {
  grid: string[];
  legend: Record<string, LegendEntry>;
}

/**
 * Renders a blueprint as grid rows plus a legend, keeping every part at its cell so ids and binding targets survive
 * a round trip. Returns null when a grid cannot express the blueprint (a cell below or left of (0, 0), or a custom
 * part id); use the `parts` form then. Parts that match a default token (same part and rotation, no extra tags) use
 * it; others get generated lowercase tokens. Extra cells of multi-cell parts are written as `=`. Validate first.
 */
export function toGrid(bp: Blueprint, registry: PartRegistry): GridForm | null {
  const defaults = Object.entries(DEFAULT_LEGEND);
  const legend: Record<string, LegendEntry> = {};
  const generated = new Map<string, string>();
  const cells = new Map<string, string>();
  let maxX = 0;
  let maxY = 0;

  for (const p of bp.parts) {
    if (p.id !== partId(p.part, p.x, p.y)) return null;
    const extraTags = p.tags.filter((t) => t !== p.id);
    let token = extraTags.length === 0 && p.auto !== false && p.armed !== true && p.makes === undefined && p.size === undefined ? defaults.find(([, e]) => e.part === p.part && (e.rot ?? 0) === p.rot)?.[0] : undefined;
    if (!token) {
      const key = JSON.stringify([p.part, p.rot, extraTags, p.auto !== false, p.armed === true, p.makes ?? null, p.size ?? null]);
      token = generated.get(key);
      if (!token) {
        token = tokenName(generated.size);
        generated.set(key, token);
        const entry: LegendEntry = { part: p.part, rot: p.rot };
        if (extraTags.length > 0) entry.tags = extraTags;
        if (p.auto === false) entry.auto = false;
        if (p.armed === true) entry.armed = true;
        if (p.makes !== undefined) entry.makes = p.makes;
        if (p.size !== undefined) entry.size = p.size;
        legend[token] = entry;
      }
    }
    for (const { cell } of partCells(p, registry)) {
      if (cell.x < 0 || cell.y < 0) return null;
      const origin = cell.x === p.x && cell.y === p.y;
      cells.set(`${cell.x},${cell.y}`, origin ? token : '=');
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
  }

  const width = Math.max(1, ...[...cells.values()].map((t) => t.length));
  const grid: string[] = [];
  for (let y = maxY; y >= 0; y--) {
    const row: string[] = [];
    for (let x = 0; x <= maxX; x++) row.push((cells.get(`${x},${y}`) ?? '.').padEnd(width));
    grid.push(row.join(' ').trimEnd());
  }
  return { grid, legend };
}

function tokenName(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return i < letters.length ? (letters[i] ?? 'a') : `p${i}`;
}
