import type { Face } from '../parts/types';
import type { ScannedPart } from './types';
import { asin, atan2, hypot } from '../math/fdlibm';

/**
 * What `scan(id, opts)` asks for (M16, `04`, scan). Every option is worked out on the host, so a script that looks at
 * a robot of thousands of parts receives only the parts it asked for (a QuickJS context parsing 3000 parts every tick
 * was most of a tick's time). Without options `scan(id)` is what it always was.
 */
export interface ScanOptions {
  /** With `most`: the point the nearest parts are counted from (defaults to `from`). */
  near?: { x: number; y: number };
  /** Only the `most` parts nearest `near` (ties: blueprint order). */
  most?: number;
  /** Only parts whose id, type, or one of whose tags is one of these (the same rule as a `set()` target). */
  of?: string[];
  /** Only parts that have one of these inputs or outputs (`throttle`: what lifts and pushes). */
  has?: string[];
  /** Adds `cover` and `coverParts` to each part: what of the robot is in front of it on the line from this point. */
  from?: { x: number; y: number };
  /** Meters either side of that line a part in front must be within (default 0.5, half a cell; at most `WIDE_MAX`). */
  wide?: number;
  /**
   * Adds `acts` to each part that acts along one of its faces (it pushes, fires, or looks that way): the way it does
   * in the world, radians counterclockwise, as `angle + (rot + spec.acts) * Math.PI / 180` of a script's own part.
   * Tells a lifter from a thruster that pushes sideways or down, and which way a fixed gun points.
   */
  acts?: boolean;
}

/** What a part must be to count as in front of another: this much nearer along the line (its neighbours at the same depth do not count). */
export const COVER_GAP = 0.3;
/** The default half-width of the line `cover` looks along: half a cell. */
export const COVER_WIDE = 0.5;
/** The widest line `cover` looks along: 3 m either side (the stock scripts use 0.5 to 1.2). */
export const WIDE_MAX = 3;
/**
 * The most pairs of parts one scan's `cover` may test (a part asked about against each part that might be in front of
 * it). Past it the scan returns null and says why, before any is tested, so the host's work per call has a ceiling.
 * The stock scripts test at most about 15,000; every part of a 3000-part titan, from 60 m off, about 200,000.
 */
export const COVER_TESTS_MAX = 250_000;
/** What `selectScanned` says when `cover` would be too much work: one line, so the script logs it once. */
export const COVER_TOO_MUCH = `scan(): cover from there would test more than ${COVER_TESTS_MAX} pairs of parts; ask about fewer (most, of, has) or from further off`;
const NAMES_MAX = 64;
const KNOWN = ['near', 'most', 'of', 'has', 'from', 'wide', 'acts'];
/** A face as radians counterclockwise from the x axis. */
const FACE_RAD: Readonly<Record<Face, number>> = { E: 0, N: Math.PI / 2, W: Math.PI, S: (3 * Math.PI) / 2 };

/**
 * Reads a script's options (plain JSON from the sandbox) into `ScanOptions`, or says what is wrong with them in a line
 * for the script's log. Strict on purpose: an option misspelled or of the wrong kind would quietly hand the script every
 * part again, which is the cost this exists to avoid.
 */
export function readScanOptions(raw: unknown): ScanOptions | string {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'scan(): the options must be an object, like { near: self.pos, most: 50 }';
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KNOWN.includes(k)) return `scan(): no option '${k.slice(0, 40)}'; the options are ${KNOWN.join(', ')}`;
  const out: ScanOptions = {};
  for (const k of ['near', 'from'] as const) {
    if (o[k] === undefined) continue;
    const p = o[k] as { x?: unknown; y?: unknown } | null;
    if (typeof p !== 'object' || p === null || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return `scan(): ${k} must be a point { x, y } of numbers`;
    out[k] = { x: p.x, y: p.y };
  }
  if (o.most !== undefined) {
    if (typeof o.most !== 'number' || !Number.isFinite(o.most) || o.most < 0) return 'scan(): most must be a number of parts, 0 or more';
    if (!out.near && !out.from) return 'scan(): most needs near, the point the nearest parts are counted from (or from)';
    out.most = Math.floor(o.most);
  }
  for (const k of ['of', 'has'] as const) {
    if (o[k] === undefined) continue;
    const v = typeof o[k] === 'string' ? [o[k]] : o[k];
    if (!Array.isArray(v) || v.length > NAMES_MAX || v.some((s) => typeof s !== 'string')) return `scan(): ${k} must be a name or a list of at most ${NAMES_MAX} names`;
    out[k] = v as string[];
  }
  if (o.wide !== undefined) {
    if (typeof o.wide !== 'number' || !Number.isFinite(o.wide) || o.wide <= 0 || o.wide > WIDE_MAX) return `scan(): wide must be a number of meters above 0 and at most ${WIDE_MAX}`;
    out.wide = o.wide;
  }
  if (o.acts !== undefined) {
    if (typeof o.acts !== 'boolean') return 'scan(): acts must be true or false';
    if (o.acts) out.acts = true;
  }
  return out;
}

/** Whether `opts` asks for anything: `{}` is a plain scan. */
export function scanAsks(opts: ScanOptions | undefined): opts is ScanOptions {
  return opts !== undefined && (opts.most !== undefined || opts.of !== undefined || opts.has !== undefined || opts.from !== undefined || opts.acts === true);
}

/** What `of`, `has` and `acts` read of a scanned part, besides its id and type. */
export interface ScanPartInfo {
  tags: readonly string[];
  /** How it was built turned, degrees counterclockwise (for `acts`). */
  rot?: number;
  def: { inputs: readonly { name: string }[]; outputs: readonly { name: string }[]; acts?: Face };
}

/**
 * The parts `opts` picks out of `parts` (everything the scan sees, in blueprint order), still in blueprint order:
 * those `of` and `has` let through, then the `most` nearest `near`. With `from`, each comes back as a copy with
 * `cover` and `coverParts`, worked out over all of `parts`, not only those returned; with `acts`, each that acts along a
 * face comes back as a copy with `acts`. `info(i)` is part i's tags, turn and definition; it is only asked when `of`,
 * `has` or `acts` is given. A line saying what is wrong (`COVER_TOO_MUCH`) instead of parts when `cover` would test
 * more than `COVER_TESTS_MAX` pairs. Pure and deterministic: no clocks, a fixed order.
 */
export function selectScanned(parts: readonly ScannedPart[], info: (i: number) => ScanPartInfo | undefined, opts: ScanOptions): ScannedPart[] | string {
  let sel: number[] = [];
  const of = opts.of;
  const has = opts.has;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as ScannedPart;
    if (of || has) {
      const about = info(i);
      if (!about) continue;
      if (of && !of.some((n) => n === p.id || n === p.type || about.tags.includes(n))) continue;
      if (has && !has.some((n) => about.def.inputs.some((c) => c.name === n) || about.def.outputs.some((c) => c.name === n))) continue;
    }
    sel.push(i);
  }
  const point = opts.near ?? opts.from;
  if (opts.most !== undefined && point && sel.length > opts.most) {
    const d = new Float64Array(parts.length);
    for (const i of sel) {
      const p = parts[i] as ScannedPart;
      const dx = p.pos.x - point.x;
      const dy = p.pos.y - point.y;
      d[i] = dx * dx + dy * dy;
    }
    sel = sel
      .slice()
      .sort((a, b) => (d[a] as number) - (d[b] as number) || a - b)
      .slice(0, opts.most)
      .sort((a, b) => a - b);
  }
  const way = (i: number, p: ScannedPart): ScannedPart => {
    if (!opts.acts) return p;
    const about = info(i);
    const face = about?.def.acts;
    if (!about || face === undefined) return p;
    return { ...p, acts: p.angle + ((about.rot ?? 0) * Math.PI) / 180 + FACE_RAD[face] };
  };
  if (!opts.from) return sel.map((i) => way(i, parts[i] as ScannedPart));
  const cover = coverAlong(parts, sel, opts.from, opts.wide ?? COVER_WIDE, COVER_TESTS_MAX);
  if (typeof cover === 'string') return cover;
  return sel.map((i, k) => ({ ...way(i, parts[i] as ScannedPart), cover: cover.health[k] as number, coverParts: cover.count[k] as number }));
}

/**
 * For each part `sel[k]`: the summed health and the count of the other parts whose middle is within `wide` m of the
 * straight line from `from` to that part's middle, and between them (more than 0 and less than its distance minus
 * `COVER_GAP` along the line). Sums are added in blueprint order, so the answer does not depend on how the candidates
 * were found: all parts against each, or (for many asked against many) only those within the angle the line's width
 * can take up seen from `from`, after sorting every part by its angle from there. `COVER_TOO_MUCH` instead, before any
 * is tested, when that would be more than `max` pairs.
 */
export function coverAlong(parts: readonly ScannedPart[], sel: readonly number[], from: { x: number; y: number }, wide: number, max = Infinity): { health: number[]; count: number[] } | string {
  const n = parts.length;
  const rx = new Float64Array(n);
  const ry = new Float64Array(n);
  let rmin = Infinity;
  for (let i = 0; i < n; i++) {
    const p = parts[i] as ScannedPart;
    const x = p.pos.x - from.x;
    const y = p.pos.y - from.y;
    rx[i] = x;
    ry[i] = y;
    const r = hypot(x, y);
    if (r > 0 && r < rmin) rmin = r;
  }
  const health: number[] = [];
  const count: number[] = [];
  const hits: number[] = [];
  /** Adds q to `hits` when it is in front of the part at (px, py), d away, along (ux, uy). */
  const test = (q: number, p: number, ux: number, uy: number, d: number): void => {
    if (q === p) return;
    const qx = rx[q] as number;
    const qy = ry[q] as number;
    const along = qx * ux + qy * uy;
    if (along <= 0 || along >= d - COVER_GAP) return;
    if (Math.abs(qx * uy - qy * ux) < wide) hits.push(q);
  };
  // Sorting pays only when many parts are asked about, more than 2 log2(n + 1) + 8; either way the same parts are found.
  const sorted = manyAsked(sel.length, n + 1);
  let order: Int32Array | undefined;
  let ang: Float64Array | undefined;
  let half = Math.PI / 2;
  if (sorted) {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = atan2(ry[i] as number, rx[i] as number);
    const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => (a[i] as number) - (a[j] as number) || i - j);
    order = Int32Array.from(idx);
    ang = Float64Array.from(idx, (i) => a[i] as number);
    // A part in front is within `wide` of the line and nearer than the part, so its angle off the line is under
    // asin(wide / its distance), and every part is at least `rmin` away.
    // A hair wider, so rounding in atan2 never leaves out a part on the edge (each is still tested exactly).
    if (wide < rmin) half = Math.min(Math.PI / 2, asin(wide / rmin) + 1e-9);
  }
  /** The parts within `half` of angle a, as at most two runs of `order` (the second when the window wraps past pi). */
  const spans = (a: number): [number, number, number, number] => {
    const at = ang as Float64Array;
    const run = (lo: number, hi: number): [number, number] => [lowerBound(at, lo), upperBound(at, hi)];
    const [s0, e0] = run(Math.max(-Math.PI, a - half), Math.min(Math.PI, a + half));
    const [s1, e1] = a - half < -Math.PI ? run(a - half + 2 * Math.PI, Math.PI) : a + half > Math.PI ? run(-Math.PI, a + half - 2 * Math.PI) : [0, 0];
    return [s0, e0, s1, e1];
  };
  // Counted before any is tested, so too much asked costs only this.
  let tests = 0;
  for (const p of sel) {
    const x = rx[p] as number;
    const y = ry[p] as number;
    if (hypot(x, y) < 0.1) continue;
    if (!order) tests += n;
    else {
      const [s0, e0, s1, e1] = spans(atan2(y, x));
      tests += Math.max(0, e0 - s0) + Math.max(0, e1 - s1);
    }
    if (tests > max) return COVER_TOO_MUCH;
  }
  for (const p of sel) {
    hits.length = 0;
    const x = rx[p] as number;
    const y = ry[p] as number;
    const d = hypot(x, y);
    if (d >= 0.1) {
      const ux = x / d;
      const uy = y / d;
      if (order) {
        const [s0, e0, s1, e1] = spans(atan2(y, x));
        for (let k = s0; k < e0; k++) test(order[k] as number, p, ux, uy, d);
        for (let k = s1; k < e1; k++) test(order[k] as number, p, ux, uy, d);
        hits.sort((i, j) => i - j);
      } else for (let q = 0; q < n; q++) test(q, p, ux, uy, d);
    }
    let sum = 0;
    for (const q of hits) sum += (parts[q] as ScannedPart).health;
    health.push(sum);
    count.push(hits.length);
  }
  return { health, count };
}

/** Whether `asked` > 2 log2(m) + 8 for whole numbers, without the host's `Math.log2`: whether 2^(asked - 8) > m^2. */
function manyAsked(asked: number, m: number): boolean {
  let p = 1;
  for (let i = 8; i < asked && p <= m * m; i++) p *= 2;
  return asked > 8 && p > m * m;
}

/** The first index whose value is above `v` in a sorted array. */
function upperBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The first index whose value is at least `v` in a sorted array. */
function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
