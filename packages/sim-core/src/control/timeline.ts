import type { RobotInput } from './types';

/** One key held from `down` to `up` seconds after the run starts. `up` equal to `down` is a one-tick tap. */
export interface KeyPress {
  key: string;
  down: number;
  up: number;
}

export class TimelineError extends Error {}

/**
 * Parses a key timeline: text like `d:0-3, a:3.5-4, w:5` (key, then seconds held from start to end, or a single
 * time for a tap), or a JSON array like `[{ "key": "d", "down": 0, "up": 3 }]` (omit `up` for a tap).
 * Keys use the binding names (`d`, `1`, `Space`). Errors say what is wrong and how to write it.
 */
export function parseKeyTimeline(spec: unknown): KeyPress[] {
  const presses = typeof spec === 'string' ? parseText(spec) : parseJson(spec);
  presses.sort((a, b) => a.down - b.down || a.key.localeCompare(b.key));
  const lastUp = new Map<string, number>();
  for (const p of presses) {
    const prev = lastUp.get(p.key);
    if (prev !== undefined && p.down <= prev) {
      throw new TimelineError(`key '${p.key}' is pressed at ${p.down} s while it is still held until ${prev} s; release it first`);
    }
    lastUp.set(p.key, p.up);
  }
  return presses;
}

function check(key: string, down: number, up: number, where: string): KeyPress {
  if (key === '') throw new TimelineError(`${where}: missing key, write it like d:0-3`);
  if (!Number.isFinite(down) || down < 0) throw new TimelineError(`${where}: start time must be a number of seconds, 0 or more`);
  if (!Number.isFinite(up)) throw new TimelineError(`${where}: end time must be a number of seconds`);
  if (up < down) throw new TimelineError(`${where}: the end (${up} s) is before the start (${down} s)`);
  return { key, down, up };
}

function parseText(text: string): KeyPress[] {
  const items = text.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (items.length === 0) throw new TimelineError('the key timeline is empty; write it like "d:0-3, a:3.5-4, w:5"');
  return items.map((item) => {
    const m = /^([^:\s]+)\s*:\s*([0-9.]+)\s*(?:-\s*([0-9.]+))?$/.exec(item);
    if (!m) throw new TimelineError(`'${item}' is not key:start-end or key:time (for example d:0-3 or w:5)`);
    const down = Number(m[2]);
    return check(m[1] ?? '', down, m[3] === undefined ? down : Number(m[3]), `'${item}'`);
  });
}

function parseJson(raw: unknown): KeyPress[] {
  if (!Array.isArray(raw)) throw new TimelineError('a JSON key timeline must be a list like [{ "key": "d", "down": 0, "up": 3 }]');
  return raw.map((e, i) => {
    const where = `timeline[${i}]`;
    if (typeof e !== 'object' || e === null) throw new TimelineError(`${where} must be an object like { "key": "d", "down": 0, "up": 3 }`);
    const o = e as Record<string, unknown>;
    if (typeof o.key !== 'string') throw new TimelineError(`${where}.key must be a key name like "d"`);
    if (typeof o.down !== 'number') throw new TimelineError(`${where}.down must be seconds`);
    if (o.up !== undefined && typeof o.up !== 'number') throw new TimelineError(`${where}.up must be seconds`);
    return check(o.key, o.down, (o.up as number | undefined) ?? o.down, where);
  });
}

/** Key edges per tick for one robot. A tap presses and releases on the same tick, which holds for that tick. */
export function timelineInputs(presses: readonly KeyPress[], robot: number, dt: number): Map<number, RobotInput> {
  const out = new Map<number, RobotInput>();
  const at = (tick: number): RobotInput => {
    let i = out.get(tick);
    if (!i) out.set(tick, (i = { robot, pressed: [], released: [] }));
    return i;
  };
  for (const p of presses) {
    const down = Math.round(p.down / dt);
    at(down).pressed.push(p.key);
    at(Math.max(down, Math.round(p.up / dt))).released.push(p.key);
  }
  return out;
}
