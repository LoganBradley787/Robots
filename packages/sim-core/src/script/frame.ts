import type { ScriptContact, ScriptInput } from './types';

/**
 * How a tick's input crosses into a script (M9). Parsing JSON text into part objects inside the sandbox was most of
 * a script's cost, so the input is split in three:
 * - the layout (JSON): each part's id, type, tags, mass, and the names of its `in` and `out` values, in order. It
 *   changes only when the robot does, and a script is sent it only when its `id` differs from the last one it saw;
 * - the numbers (one Float64Array): everything that moves, in a fixed order (`HEADER`, `SELF`, then per part its
 *   position, angle, `in` values, and `out` values);
 * - the extras (JSON, or '' when all are empty): keys, contacts, and inbox.
 * A script sees exactly what `JSON.parse(JSON.stringify(input))` would give: `-0` arrives as `0` (the writer turns it
 * into `0`) and a number that is not finite as `null` (the `finite` slot tells the sandbox to check).
 */
export interface ScriptLayout {
  /** Unique per world and layout: a script re-reads the layout only when this changes. */
  id: number;
  /** The whole layout (`layoutJson`). */
  json: string;
  /**
   * The same layout as a patch on layout `from` (`layoutPatch`), for a script that holds that one: it keeps the part
   * objects of every part that is as it was and makes only the others. A script holding any other layout reads `json`.
   */
  patch?: { from: number; json: string };
}

export interface ScriptFrame {
  layout: ScriptLayout;
  numbers: Float64Array;
  extras: string;
}

/** One part in a layout. `in` and `out` are the names present this tick, in the order the script sees them. */
export interface LayoutPart {
  id: string;
  type: string;
  tags: readonly string[];
  mass: number;
  in: readonly string[];
  out: readonly string[];
}

/** Slots at the start of the numbers: 1 when every number is finite, then frame, dt, time. */
export const HEADER = 4;
/** Then `self`: pos x, y, vel x, y, angle, angVel, mass, energy stored, capacity. */
export const SELF = 9;
/** Then per part: pos x, y, angle, then its `in` values, then its `out` values. */
export const PART_FIXED = 3;

export function layoutJson(parts: readonly LayoutPart[]): string {
  return JSON.stringify(parts.map((p) => [p.id, p.type, p.tags, p.mass, p.in, p.out]));
}

/** Whether two lists of names (tags, or the values present) are the same names in the same order. */
export function sameNames(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** How far ahead a part is looked for in the old layout before the old ids are put in a map. */
const PATCH_LOOK = 32;

/**
 * `now` as a patch on `old`, for a script that holds `old`: JSON text `[parts, mode, ops]`.
 * - Mode 2: only parts gone. `ops` is the gaps, each `[from, to]` of old indexes (to not included), in order.
 * - Otherwise `ops` builds the new list in order: `[from, to]` keeps those old parts as they are, and a layout entry
 *   (`[id, type, tags, mass, in, out]`, as in `layoutJson`) makes a part. An entry with a seventh item, an old index,
 *   is that old part with other values present: same id, type, and tags, standing where it stood.
 *   Mode 1 says the kept and replaced parts are in their old order and every other new part comes after them all (so
 *   what a script keeps per type and tag can follow along); mode 0 says nothing.
 * A part is kept only when every field of its entry is equal, so the patched layout is the new one, field for field.
 * Undefined when nothing of `old` is kept (the whole layout is then no more work).
 */
export function layoutPatch(old: readonly LayoutPart[], now: readonly LayoutPart[]): string | undefined {
  let ids: Map<string, number> | undefined;
  /** Where the part is in `old`, at `from` or later: looked for a little way ahead first (a lost part leaves a small gap). */
  const find = (id: string, from: number): number => {
    if (!ids) {
      const end = Math.min(old.length, from + PATCH_LOOK);
      for (let j = from; j < end; j++) if (old[j]?.id === id) return j;
      if (end === old.length) return -1;
      ids = new Map();
      for (let j = 0; j < old.length; j++) ids.set((old[j] as LayoutPart).id, j);
    }
    return ids.get(id) ?? -1;
  };
  const ops: (number[] | unknown[])[] = [];
  const gaps: number[][] = [];
  let next = 0;
  let kept = 0;
  let made = 0;
  /** Whether a part that was never in `old` (or moved) has been made yet: nothing kept may come after one. */
  let fresh = false;
  let ordered = true;
  let run: number[] | undefined;
  for (const p of now) {
    const k = find(p.id, next);
    const was = k >= 0 ? (old[k] as LayoutPart) : undefined;
    const sameShape = was !== undefined && was !== p && was.type === p.type && sameNames(was.tags, p.tags);
    // A part behind where the walk has got to has moved: it is made anew, like one that was never there.
    if (was && k >= next && (was === p || (sameShape && was.mass === p.mass && sameNames(was.in, p.in) && sameNames(was.out, p.out)))) {
      if (fresh) ordered = false;
      if (k > next) gaps.push([next, k]);
      if (run && run[1] === k) run[1] = k + 1;
      else ops.push((run = [k, k + 1]));
      next = k + 1;
      kept++;
      continue;
    }
    run = undefined;
    made++;
    const entry: unknown[] = [p.id, p.type, p.tags, p.mass, p.in, p.out];
    if (was && sameShape && k >= next) {
      if (fresh) ordered = false;
      if (k > next) gaps.push([next, k]);
      entry.push(k);
      next = k + 1;
    } else {
      fresh = true;
    }
    ops.push(entry);
  }
  if (kept === 0) return undefined;
  if (next < old.length) gaps.push([next, old.length]);
  return JSON.stringify(made === 0 ? [now.length, 2, gaps] : [now.length, ordered ? 1 : 0, ops]);
}

/** How many numbers a layout needs. */
export function numberCount(parts: readonly LayoutPart[]): number {
  let n = HEADER + SELF;
  for (const p of parts) n += PART_FIXED + p.in.length + p.out.length;
  return n;
}

/** Writes `v` at `k` (`-0` as `0`, as JSON would) and returns whether it is finite. */
export function put(numbers: Float64Array, k: number, v: number): boolean {
  numbers[k] = v === 0 ? 0 : v;
  return v - v === 0;
}

/** Writes the header and `self`; returns whether every number was finite. */
export function putHead(numbers: Float64Array, input: Pick<ScriptInput, 'frame' | 'dt' | 'time' | 'self'>): boolean {
  const s = input.self;
  let ok = put(numbers, 1, input.frame);
  ok = put(numbers, 2, input.dt) && ok;
  ok = put(numbers, 3, input.time) && ok;
  let k = HEADER;
  for (const v of [s.pos.x, s.pos.y, s.vel.x, s.vel.y, s.angle, s.angVel, s.mass, s.energy.stored, s.energy.capacity]) ok = put(numbers, k++, v) && ok;
  return ok;
}

/**
 * Keys, contacts, and inbox as JSON, or '' when all three are empty (the usual case). `contacts`, when given, is
 * `JSON.stringify(input.contacts)` already made (the world builds it from pieces it keeps, `contactHead`).
 */
export function extrasJson(input: Pick<ScriptInput, 'keys' | 'contacts' | 'inbox'>, contacts?: string): string {
  const k = input.keys;
  if (k.down.length === 0 && k.pressed.length === 0 && k.released.length === 0 && input.contacts.length === 0 && input.inbox.length === 0) return '';
  if (contacts === undefined) return JSON.stringify([k, input.contacts, input.inbox]);
  return `[${JSON.stringify(k)},${contacts},${JSON.stringify(input.inbox)}]`;
}

/** A number as JSON writes it: `null` when it is not finite. */
function jsonNumber(v: number): string {
  return v - v === 0 ? String(v) : 'null';
}

function jsonPoint(p: { x: number; y: number }): string {
  return `{"x":${jsonNumber(p.x)},"y":${jsonNumber(p.y)}}`;
}

/**
 * The middle of a contact's JSON text, from `core` to `parts`: what is the same for every viewer of that robot, so
 * the world writes it once per tick however many robots see it (the numbers are most of the work).
 */
export function contactMiddle(c: Pick<ScriptContact, 'core' | 'pos' | 'vel' | 'center' | 'mass' | 'parts'>): string {
  return `"core":${c.core ? 'true' : 'false'},"pos":${jsonPoint(c.pos)},"vel":${jsonPoint(c.vel)},"center":${jsonPoint(c.center)},"mass":${jsonNumber(c.mass)},"parts":${jsonNumber(c.parts)}`;
}

/** A contact's JSON text up to its distance, around its middle. `side` is one of three plain words. */
export function contactHead(id: number, side: ScriptContact['side'], middle: string): string {
  return `{"id":${jsonNumber(id)},"side":"${side}",${middle},"distance":`;
}

/** The rest: with `contactHead` exactly `JSON.stringify(contact)`. */
export function contactJson(head: string, distance: number, by: readonly string[]): string {
  return `${head}${jsonNumber(distance)},"by":${JSON.stringify(by)}}`;
}

/**
 * A plain `ScriptInput` as a frame, with a layout read off its parts. For tests and callers that build input by
 * hand; the world builds frames directly and keeps its layouts between ticks.
 */
export function inputToFrame(input: ScriptInput, layoutId: number): ScriptFrame {
  const parts: LayoutPart[] = input.parts.map((p) => ({ id: p.id, type: p.type, tags: p.tags, mass: p.mass, in: Object.keys(p.in), out: Object.keys(p.out) }));
  const numbers = new Float64Array(numberCount(parts));
  let ok = putHead(numbers, input);
  let k = HEADER + SELF;
  for (const p of input.parts) {
    ok = put(numbers, k++, p.pos.x) && ok;
    ok = put(numbers, k++, p.pos.y) && ok;
    ok = put(numbers, k++, p.angle) && ok;
    for (const v of Object.values(p.in)) ok = put(numbers, k++, v) && ok;
    for (const v of Object.values(p.out)) ok = put(numbers, k++, v) && ok;
  }
  numbers[0] = ok ? 1 : 0;
  return { layout: { id: layoutId, json: layoutJson(parts) }, numbers, extras: extrasJson(input) };
}
