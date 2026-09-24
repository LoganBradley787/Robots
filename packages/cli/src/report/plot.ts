import type { WorldFile } from '@robots/sim-core';

export interface PlotTrack {
  /** One character; letters are drawn lowercase along the path and uppercase where the track ends. */
  mark: string;
  points: readonly { x: number; y: number }[];
  /** Its parts where it ended, drawn in its uppercase letter so a wall or a robot shows its shape. */
  shape?: readonly { x: number; y: number }[];
}

export interface PlotInput {
  world: WorldFile;
  tracks: readonly PlotTrack[];
  blasts: readonly { x: number; y: number }[];
  /** Most columns of the plot (default 72). */
  width?: number;
  /** Most rows of the plot (default 24). */
  maxRows?: number;
}

const MIN_ROWS = 8;
const NICE = [1, 2, 2.5, 5];

/** The smallest of 0.1, 0.2, 0.25, 0.5, 1, 2, ... that is at least `v`. */
function nice(v: number): number {
  if (!(v > 0 && Number.isFinite(v))) return 1;
  for (let exp = Math.floor(Math.log10(v)) - 1; ; exp++) {
    for (const n of NICE) {
      const s = n * 10 ** exp;
      if (s >= v - 1e-12) return Number(s.toPrecision(6));
    }
  }
}

function inTerrain(world: WorldFile, x: number, y: number): boolean {
  // The ground is drawn solid all the way down, so it shows at any scale.
  if (Math.abs(x) <= world.ground.width / 2 && y <= 0) return true;
  for (const b of world.boxes) {
    const a = (-b.angleDeg * Math.PI) / 180;
    const dx = x - b.x;
    const dy = y - b.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return true;
  }
  return false;
}

/** A cell center, with the decimals that half a cell needs (0.25 m cells: 2). */
function fmt(v: number, step: number): string {
  const half = String(step / 2);
  const decimals = Math.min(3, half.includes('.') ? half.length - half.indexOf('.') - 1 : 0);
  return (Math.round(v * 1000) / 1000 + 0).toFixed(decimals);
}

/**
 * An ASCII side view of where things went (M7, for Claude): terrain as `#` (boxes where they started), each track
 * as its lowercase letter with its last point uppercase, blasts as `*`. y is up (the top row is highest). x and y
 * have their own round scales, printed in the header, so a long flight still shows its height.
 */
export function plotPaths(input: PlotInput): string[] {
  const width = input.width ?? 72;
  const maxRows = input.maxRows ?? 24;
  // Everything drawn sets the bounds (a robot's parts reach past its core's path); a point flung to infinity by the
  // physics is left out rather than breaking the plot.
  const finite = (p: { x: number; y: number }): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
  const tracks = input.tracks.map((t) => ({ ...t, points: t.points.filter(finite), shape: (t.shape ?? []).filter(finite) }));
  const blasts = input.blasts.filter(finite);
  let x0 = Infinity;
  let x1 = -Infinity;
  let yMin = 0;
  let yMax = -Infinity;
  const grow = (p: { x: number; y: number }): void => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  };
  for (const t of tracks) {
    for (const p of t.points) grow(p);
    for (const p of t.shape) grow(p);
  }
  for (const b of blasts) grow(b);
  if (!Number.isFinite(x0)) return [];
  x0 -= 1;
  x1 += 1;
  const y0 = yMin - 1;
  let y1 = yMax + 1;
  if (x1 - x0 < 6) {
    const mid = (x0 + x1) / 2;
    x0 = mid - 3;
    x1 = mid + 3;
  }

  const sx = nice((x1 - x0) / width);
  // Rows fit the height on their own scale (a long flat flight still shows its altitude), but are never more than
  // ten times as fine as columns are wide.
  const sy = nice(Math.max((y1 - y0) / (maxRows - 1), sx / 10));
  const bottom = Math.floor(y0 / sy) * sy;
  if (Math.ceil((y1 - bottom) / sy - 1e-9) < MIN_ROWS) y1 = bottom + MIN_ROWS * sy;
  const rows = Math.ceil((y1 - bottom) / sy - 1e-9);
  const left = Math.floor(x0 / sx) * sx;
  const cols = Math.ceil((x1 - left) / sx - 1e-9);

  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    const yTop = bottom + (rows - r) * sy;
    for (let c = 0; c < cols; c++) {
      let inside = 0;
      for (const fx of [1 / 6, 1 / 2, 5 / 6]) for (const fy of [1 / 6, 1 / 2, 5 / 6]) if (inTerrain(input.world, left + (c + fx) * sx, yTop - fy * sy)) inside++;
      row.push(inside >= 3 ? '#' : ' ');
    }
    grid.push(row);
  }
  const put = (p: { x: number; y: number }, ch: string): void => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x - left) / sx)));
    const r = Math.min(rows - 1, Math.max(0, rows - 1 - Math.floor((p.y - bottom) / sy)));
    const row = grid[r];
    if (row) row[c] = ch;
  };
  // One character per piece: marks past Z (AA, AB, ...) draw as +.
  const ch = (mark: string): string => (mark.length === 1 ? mark : '+');
  for (const t of tracks) for (const p of t.points) put(p, ch(t.mark).toLowerCase());
  for (const b of blasts) put(b, '*');
  for (const t of tracks) for (const p of t.shape) put(p, ch(t.mark).toUpperCase());
  for (const t of tracks) {
    const last = t.points.at(-1);
    if (last) put(last, ch(t.mark).toUpperCase());
  }

  const labels = grid.map((_, r) => fmt(bottom + (rows - r - 0.5) * sy, sy));
  const gutter = Math.max(...labels.map((l) => l.length));
  const out = [`side view: 1 column = ${sx} m, 1 row = ${sy} m (lowercase: the path of each piece's core, uppercase: its parts where it ended, *: explosion, #: ground and boxes as they started)`];
  grid.forEach((row, r) => out.push(`${(labels[r] ?? '').padStart(gutter)} |${row.join('')}`));
  const xs = [0, Math.floor(cols / 2), cols - 1].map((c) => fmt(left + (c + 0.5) * sx, sx));
  const ruler = Array.from({ length: cols }, () => ' ');
  const place = (text: string, at: number): void => {
    for (let i = 0; i < text.length; i++) if (at + i >= 0 && at + i < cols) ruler[at + i] = text[i] ?? ' ';
  };
  place(xs[0] ?? '', 0);
  place(xs[1] ?? '', Math.floor(cols / 2) - Math.floor((xs[1] ?? '').length / 2));
  place(xs[2] ?? '', cols - (xs[2] ?? '').length);
  out.push(`${'x'.padStart(gutter)}  ${ruler.join('').trimEnd()}`);
  return out;
}
