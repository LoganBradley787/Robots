import type { ScriptContact, ScriptInput } from './types';

/**
 * How a tick's input crosses into a script (M9). Parsing JSON text into part objects inside the sandbox was most of
 * a script's cost, so the input is split in three:
 * - the layout (JSON): each part's id, type, tags, mass, the names of its `in` and `out` values, in order, and (M16)
 *   how it was built turned and which joint carries it (`rot`, `on`), and (M16 review) where its middle is (`center`). It
 *   changes only when the robot does, and a script is sent it only when its `id` differs from the last one it saw.
 *   With it goes `specs` (M16): each part type's static numbers (`partSpec.ts`), which never change, so a script is
 *   sent that text once and every part of a type shares one `spec` object;
 * - the numbers (one Float64Array): everything that moves, in a fixed order (`HEADER`, `SELF`, then per part its
 *   position, angle, `in` values, and `out` values);
 * - the contacts (a second Float64Array, absent when there are none): `CONTACT` numbers per contact (`contactFrame`).
 *   As text they cost more than everything else a script is handed (a big fight sees 60 robots: 16 kB of JSON a call),
 *   and a script makes the objects only when it first reads `contacts` in a tick;
 * - the extras (JSON, or '' when all are empty): keys, each different `by` list of the contacts, and inbox.
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
  /**
   * M16: each part type's static numbers as JSON, `{ "<type>": spec }` (`partSpecsJson`), for at least every type in
   * the layout. A script is sent it before the layout, and only when it is not the text it was sent last (the world
   * hands every layout the same one). Absent: parts have no `spec`.
   */
  specs?: string;
}

export interface ScriptFrame {
  layout: ScriptLayout;
  numbers: Float64Array;
  extras: string;
  /** The contacts as numbers (`contactFrame`); absent when there are none. */
  contacts?: Float64Array;
}

/** One part in a layout. `in` and `out` are the names present this tick, in the order the script sees them. */
export interface LayoutPart {
  id: string;
  type: string;
  tags: readonly string[];
  mass: number;
  in: readonly string[];
  out: readonly string[];
  /**
   * M16: how the part was built turned, in degrees counterclockwise (0, 90, 180, 270), as in its blueprint. With `on`
   * it is what a script cannot work out from positions: which way a part pushes, and which joint carries it.
   * Absent (both, or neither) only from a layout built by hand without them: the part then has no such keys.
   */
  rot?: number;
  /**
   * M16: the id of the joint part that carries the part: the one whose turning or sliding side it is bolted to, through
   * any number of welded parts. For a joint part itself, the joint that carries what it is mounted on, so a chain
   * (a gun on a hinge on a hinge) is walked one `on` at a time. '' when no joint carries it.
   */
  on?: string;
  /**
   * M16 review: where the part's middle is (the middle of its cells at the size it was placed, where its weight is),
   * from its position, built unturned, in meters. Absent for a part whose middle is its position (one cell): a script
   * then reads 0, 0. Sent with `rot` and `on`, so a script works out a robot's weight without taking a cannon or a
   * fabricator bay to weigh at its first cell.
   */
  center?: { x: number; y: number };
}

/** A layout entry as sent: `[id, type, tags, mass, in, out]`, `rot, on` after them when the part has them, then `[x, y]` when it has a center. */
function entryOf(p: LayoutPart): unknown[] {
  if (p.rot === undefined && p.on === undefined) return [p.id, p.type, p.tags, p.mass, p.in, p.out];
  return p.center === undefined ? [p.id, p.type, p.tags, p.mass, p.in, p.out, p.rot ?? 0, p.on ?? ''] : [p.id, p.type, p.tags, p.mass, p.in, p.out, p.rot ?? 0, p.on ?? '', [p.center.x, p.center.y]];
}

/** Whether two parts' centers are the same (both absent, or the same numbers). */
function sameCenter(a: LayoutPart['center'], b: LayoutPart['center']): boolean {
  return a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y);
}

/** Slots at the start of the numbers: 1 when every number is finite, then frame, dt, time. */
export const HEADER = 4;
/** Then `self`: pos x, y, vel x, y, angle, angVel, mass, energy stored, capacity, age (M16). */
export const SELF = 10;
/** Then per part: pos x, y, angle, then its `in` values, then its `out` values. */
export const PART_FIXED = 3;

export function layoutJson(parts: readonly LayoutPart[]): string {
  return JSON.stringify(parts.map(entryOf));
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
 *   (`[id, type, tags, mass, in, out, rot, on, center]`, as in `layoutJson` but always with `rot`, `on` and `center`,
 *   null for a part without them) makes a part. An entry with a tenth item, an old index, is that old part with other
 *   values present: same id, type, and tags, standing where it stood.
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
    if (was && k >= next && (was === p || (sameShape && was.mass === p.mass && was.rot === p.rot && was.on === p.on && sameCenter(was.center, p.center) && sameNames(was.in, p.in) && sameNames(was.out, p.out)))) {
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
    const entry: unknown[] = [p.id, p.type, p.tags, p.mass, p.in, p.out, p.rot ?? null, p.on ?? null, p.center ? [p.center.x, p.center.y] : null];
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
  for (const v of [s.pos.x, s.pos.y, s.vel.x, s.vel.y, s.angle, s.angVel, s.mass, s.energy.stored, s.energy.capacity, s.age ?? 0]) ok = put(numbers, k++, v) && ok;
  return ok;
}

/**
 * Keys, the contacts' `by` lists (`contactFrame`), and inbox as JSON, or '' when all three are empty (the usual case;
 * there are `by` lists only when there are contacts).
 */
export function extrasJson(input: Pick<ScriptInput, 'keys' | 'inbox'>, by: readonly (readonly string[])[]): string {
  const k = input.keys;
  if (k.down.length === 0 && k.pressed.length === 0 && k.released.length === 0 && by.length === 0 && input.inbox.length === 0) return '';
  return JSON.stringify([k, by, input.inbox]);
}

/** Numbers per contact: id, side, core, pos x, y, vel x, y, center x, y, mass, parts, distance, its `by` list. */
export const CONTACT = 13;
const SIDES: Readonly<Record<ScriptContact['side'], number>> = { enemy: 0, friend: 1, none: 2 };

/**
 * The contacts as numbers, after a slot that is 1 when every number is finite (as in the frame's numbers) and one with
 * their count, and their `by` lists, each different list once, in the order they first come: a contact's last number
 * is its list's place. The sandbox makes from them exactly what
 * `JSON.parse(JSON.stringify(contacts))` gives. Undefined when there are none.
 */
export function contactFrame(contacts: readonly ScriptContact[]): { numbers: Float64Array; by: (readonly string[])[] } | undefined {
  if (contacts.length === 0) return undefined;
  const numbers = new Float64Array(2 + CONTACT * contacts.length);
  numbers[1] = contacts.length;
  const lists: (readonly string[])[] = [];
  let ok = true;
  let k = 2;
  for (const c of contacts) {
    ok = put(numbers, k++, c.id) && ok;
    numbers[k++] = SIDES[c.side];
    numbers[k++] = c.core ? 1 : 0;
    ok = put(numbers, k++, c.pos.x) && ok;
    ok = put(numbers, k++, c.pos.y) && ok;
    ok = put(numbers, k++, c.vel.x) && ok;
    ok = put(numbers, k++, c.vel.y) && ok;
    ok = put(numbers, k++, c.center.x) && ok;
    ok = put(numbers, k++, c.center.y) && ok;
    ok = put(numbers, k++, c.mass) && ok;
    ok = put(numbers, k++, c.parts) && ok;
    ok = put(numbers, k++, c.distance) && ok;
    let i = lists.findIndex((b) => sameNames(b, c.by));
    if (i < 0) i = lists.push(c.by) - 1;
    numbers[k++] = i;
  }
  numbers[0] = ok ? 1 : 0;
  return { numbers, by: lists };
}

/**
 * A plain `ScriptInput` as a frame, with a layout read off its parts. For tests and callers that build input by
 * hand; the world builds frames directly and keeps its layouts between ticks.
 */
export function inputToFrame(input: ScriptInput, layoutId: number): ScriptFrame {
  const parts: LayoutPart[] = input.parts.map((p) => ({ id: p.id, type: p.type, tags: p.tags, mass: p.mass, in: Object.keys(p.in), out: Object.keys(p.out), ...(p.rot !== undefined || p.on !== undefined ? { rot: p.rot ?? 0, on: p.on ?? '' } : {}) }));
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
  // The spec of each type, from the first part of the type that has one.
  const specs = new Map<string, string>();
  for (const p of input.parts) if (p.spec !== undefined && !specs.has(p.type)) specs.set(p.type, JSON.stringify(p.spec));
  const specsJson = specs.size === 0 ? undefined : `{${[...specs].map(([type, json]) => `${JSON.stringify(type)}:${json}`).join(',')}}`;
  const contacts = contactFrame(input.contacts);
  return { layout: { id: layoutId, json: layoutJson(parts), ...(specsJson !== undefined ? { specs: specsJson } : {}) }, numbers, extras: extrasJson(input, contacts?.by ?? []), ...(contacts ? { contacts: contacts.numbers } : {}) };
}
