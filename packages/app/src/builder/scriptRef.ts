import { isCore, namesAvailable, partsReached, robotSees, rootPartId, type Blueprint, type ChannelDef, type PartRegistry } from '@robots/sim-core';
import { controlsOf } from './coreControls';

/**
 * What stands beside the code in the script view (M16, plan section 7): "This robot" (every group, kind of part and
 * single part a script can name, with its inputs and what it reports) and "You can use" (the whole script API, from
 * ONE table, which completion and hover help read too). Pure data: the editor only draws it.
 */

/** An input or an output of a target. */
export interface RefChannel {
  name: string;
  /** "0 to 1", "-1 to 1". */
  range: string;
  /** What the numbers mean, in a few words: "off to full". */
  words: string;
  /** What a click puts in the code. For an input the caret goes where the value is typed (`caret` characters from the end). */
  insert: string;
  /** How many characters before the end of `insert` the caret lands. 0: after it. */
  caret: number;
  /** How many of the target's parts have it, when not all do. */
  on?: number;
}

/** Something a script can name in `set()` and `get()`. */
export interface RefTarget {
  kind: 'group' | 'kind' | 'part';
  /** The name as a script writes it: a group, a part type, a part id. */
  name: string;
  /** What the list shows: the group, the part's name ("Propeller"), the part's id. */
  label: string;
  /** How many parts answer to it. */
  count: number;
  /** In a few words what it is: "4 propellers", "Propeller at 2, 1". */
  what: string;
  inputs: RefChannel[];
  outputs: RefChannel[];
  /** The parts, to light them on the board. */
  ids: string[];
}

export interface RobotRef {
  groups: RefTarget[];
  kinds: RefTarget[];
  parts: RefTarget[];
  /** The scope the script's core sees names through (a placed copy's own core). */
  scope?: string;
  /** Whether anything fills `contacts`. */
  sees: boolean;
  /** Whether the robot has another core to send a message to, or builds one. */
  others: boolean;
}

const n2 = (v: number): string => String(Number(v.toFixed(3)));

/** A range in plain words: what the two ends mean. */
function rangeWords(c: ChannelDef, input: boolean): string {
  if (!input) return c.min === 0 && c.max === 1 ? 'none to all' : '';
  if (c.min === 0 && c.max === 1) return 'off to full';
  if (c.min === -c.max && c.max > 0) return `full one way to full the other${c.default === 0 ? ', 0 rests' : ''}`;
  return c.default !== 0 ? `rests at ${n2(c.default)}` : '';
}

function channels(defs: ReadonlyArray<{ channels: readonly ChannelDef[] }>, target: string, input: boolean): RefChannel[] {
  const out: RefChannel[] = [];
  const seen = new Map<string, number>();
  for (const d of defs) for (const c of d.channels) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  for (const d of defs) {
    for (const c of d.channels) {
      if (out.some((o) => o.name === c.name)) continue;
      const insert = input ? `set(${JSON.stringify(target)}, ${JSON.stringify(c.name)}, )` : `get(${JSON.stringify(target)}, ${JSON.stringify(c.name)})`;
      const on = seen.get(c.name) ?? 0;
      out.push({ name: c.name, range: `${n2(c.min)} to ${n2(c.max)}`, words: rangeWords(c, input), insert, caret: input ? 1 : 0, ...(on < defs.length ? { on } : {}) });
    }
  }
  return out;
}

/** "4 propellers", "2 parts" for a mix. */
function counted(registry: PartRegistry, types: readonly string[]): string {
  const kinds = new Set(types);
  const one = types[0] ?? '';
  const word = kinds.size === 1 ? (registry.has(one) ? registry.get(one).name.toLowerCase() : one) : 'part';
  return `${types.length} ${word}${types.length === 1 ? '' : 's'}`;
}

/**
 * Everything on the robot a script of this core can name, in the order a writer wants it: groups first (they survive
 * edits), then kinds of part, then single parts. Each with the inputs it takes and what it reports. Parts with nothing
 * to drive or read are left out.
 */
export function robotReference(bp: Blueprint, registry: PartRegistry, core?: string): RobotRef {
  const scope = controlsOf(bp, registry, core).scope;
  const members = scope === undefined ? bp.parts : bp.parts.filter((p) => p.tags.includes(scope));
  const names = namesAvailable(bp, registry, scope);
  const target = (kind: RefTarget['kind'], name: string, label: string, what?: string): RefTarget | undefined => {
    const reached = partsReached(bp, registry, name, scope).filter((p) => registry.has(p.part));
    if (reached.length === 0) return undefined;
    const defs = reached.map((p) => registry.get(p.part));
    const inputs = channels(defs.map((d) => ({ channels: d.inputs })), name, true);
    const outputs = channels(defs.map((d) => ({ channels: d.outputs })), name, false);
    if (inputs.length === 0 && outputs.length === 0) return undefined;
    return { kind, name, label, count: reached.length, what: what ?? counted(registry, reached.map((p) => p.part)), inputs, outputs, ids: reached.map((p) => p.id) };
  };
  const some = <T>(list: Array<T | undefined>): T[] => list.filter((x): x is T => x !== undefined);
  const groups = some(names.tags.map((t) => target('group', t, t)));
  const types = [...new Set(members.map((p) => p.part))];
  const kinds = some(types.map((t) => target('kind', t, registry.has(t) ? registry.get(t).name : t)));
  const parts = some(members.map((p) => target('part', p.id, p.id, `${registry.has(p.part) ? registry.get(p.part).name : p.part} at ${p.x}, ${p.y}`)));
  const root = rootPartId(bp, registry);
  const others = bp.parts.some((p) => p.id !== root && isCore(p, registry)) || bp.parts.some((p) => p.makes !== undefined);
  return { groups, kinds, parts, ...(scope !== undefined ? { scope } : {}), sees: robotSees(bp, registry, scope), others };
}

/** One thing of the script API. */
export interface ApiEntry {
  /** As it is listed and completed: `self.pos`, `set`, `keys.down`. */
  name: string;
  /** As it is called or read: `set(who, input, value)`. */
  sig: string;
  /** One plain line. */
  about: string;
  /** What a click puts in the code, and how many characters before its end the caret lands (0: after it). */
  insert: string;
  caret?: number;
  section: 'The robot' | 'Parts' | 'Seeing' | 'Keys' | 'Messages' | 'Settings and memory' | 'Maths';
  /** What the robot must have for it to do anything: something that sees, or another core. */
  needs?: 'sees' | 'others';
  /** More for the hover card: the facts that trip people up. */
  more?: string;
}

/** The whole script API. The list beside the code, completion, and hover help all read this one table. */
export const SCRIPT_API: readonly ApiEntry[] = [
  { name: 'self.pos', sig: 'self.pos', about: 'where the robot is, in meters: x right, y up', insert: 'self.pos.y', section: 'The robot' },
  { name: 'self.vel', sig: 'self.vel', about: 'how fast it moves, in meters a second', insert: 'self.vel.y', section: 'The robot' },
  { name: 'self.angle', sig: 'self.angle', about: 'how far it leans, in radians, counterclockwise', insert: 'self.angle', section: 'The robot' },
  { name: 'self.angVel', sig: 'self.angVel', about: 'how fast it turns, in radians a second', insert: 'self.angVel', section: 'The robot' },
  { name: 'self.mass', sig: 'self.mass', about: 'what it weighs now, in kg', insert: 'self.mass', section: 'The robot' },
  { name: 'self.energy', sig: 'self.energy', about: 'its energy: stored and capacity', insert: 'self.energy.stored', section: 'The robot' },
  { name: 'time', sig: 'time', about: 'seconds since the world began', insert: 'time', section: 'The robot' },
  { name: 'dt', sig: 'dt', about: 'seconds one tick lasts (1/60)', insert: 'dt', section: 'The robot' },
  { name: 'frame', sig: 'frame', about: 'the tick number', insert: 'frame', section: 'The robot' },

  { name: 'set', sig: 'set(who, input, value)', about: 'drive a part, a kind of part, or a group', insert: 'set("", "", )', caret: 8, section: 'Parts', more: 'who is a group, a kind of part, or one part\'s id. Every part it names that has the input gets the value. A key held on the same input wins over it.' },
  { name: 'get', sig: 'get(who, name)', about: 'read an input or an output of one part', insert: 'get("", "")', caret: 6, section: 'Parts', more: 'On a group or a kind it reads the FIRST matching part, not all of them. To read each one, loop over parts.' },
  { name: 'parts', sig: 'parts', about: 'every part still attached, as a list', insert: 'for (const p of parts) {\n  \n}', caret: 2, section: 'Parts' },
  { name: 'part.id', sig: 'p.id, p.type, p.tags', about: 'its name, its kind, and the groups it is in', insert: 'p.tags.includes("")', caret: 2, section: 'Parts' },
  { name: 'part.pos', sig: 'p.pos, p.angle, p.mass', about: 'where it is, how its body is turned, what it weighs', insert: 'p.pos', section: 'Parts' },
  { name: 'part.in', sig: 'p.in, p.out', about: 'its inputs as of last tick, and what it reports', insert: 'p.out', section: 'Parts' },
  { name: 'part.spec', sig: 'p.spec', about: 'its strength and ranges, from its definition', insert: 'p.spec.config.maxForce', section: 'Parts', more: 'p.spec.in.<input>.max, p.spec.config.maxForce or maxTorque, p.spec.powerDraw, and each block of its definition (p.spec.gun.speed). Add these up instead of typing numbers in: the script then survives an edit to the robot.' },
  { name: 'part.rot', sig: 'p.rot', about: 'how it was built turned: 0, 90, 180 or 270', insert: 'p.rot', section: 'Parts', more: 'The way a part acts in the world is p.angle + (p.rot + p.spec.acts) * Math.PI / 180.' },
  { name: 'part.on', sig: 'p.on', about: 'the id of the joint that carries it, or ""', insert: 'p.on', section: 'Parts', more: 'How a script pairs each firing part with the joint that aims it, whatever the turret is called.' },

  { name: 'contacts', sig: 'contacts', about: 'robots its sensors see, nearest first', insert: 'contacts[0]', section: 'Seeing', needs: 'sees', more: 'Each has id, side (enemy, friend, none), pos, vel, distance, mass, parts. A part that sees has NO distance output: there is nothing to get() from it. Read contacts.' },
  { name: 'scan', sig: 'scan(id, { near, most, of, has, from, acts })', about: 'the parts of a robot it sees, or null', insert: 'scan(contacts[0].id, { near: self.pos, most: 50 })', section: 'Seeing', needs: 'sees', more: 'Each has id, type, pos, angle, health, maxHealth. Ask only for what you need: a titan has thousands of parts. near and most: the most parts nearest a point. of: parts with these ids, types or tags. has: parts with this input or output ("throttle"). from: each part also gets cover, the health in front of it on the line from that point. acts: true: each part that pushes or fires also gets acts, the way it does in the world (radians). At most 4 calls a tick.' },

  { name: 'keys.down', sig: 'keys.down("w")', about: 'is a key held right now', insert: 'keys.down("")', caret: 2, section: 'Keys' },
  { name: 'keys.pressed', sig: 'keys.pressed("w")', about: 'did it go down this tick', insert: 'keys.pressed("")', caret: 2, section: 'Keys' },
  { name: 'keys.released', sig: 'keys.released("w")', about: 'did it come up this tick', insert: 'keys.released("")', caret: 2, section: 'Keys' },

  { name: 'send', sig: 'send(to, data)', about: 'a message to another core on this robot', insert: 'send("", {})', caret: 6, section: 'Messages', needs: 'others' },
  { name: 'inbox', sig: 'inbox', about: 'messages sent to this core, oldest first', insert: 'inbox', section: 'Messages', needs: 'others' },

  { name: 'param', sig: 'param(name, value, { min, max })', about: 'a number you set with a slider in the builder', insert: 'const x = param("x", 1, { min: 0, max: 10 }); // what it means', section: 'Settings and memory', more: 'Written once at the top. The comment after it on the same line is shown under the slider.' },
  { name: 'state', sig: 'state', about: 'remembers things between ticks', insert: 'state.', section: 'Settings and memory', more: 'Emptied when the script is switched on; setup() fills it.' },
  { name: 'log', sig: 'log(...)', about: 'a line in the readout in the world', insert: 'log()', caret: 1, section: 'Settings and memory' },
  { name: 'mark', sig: 'mark(x, y, label)', about: 'a point on the debug overlay', insert: 'mark(self.pos.x, self.pos.y, "")', caret: 2, section: 'Settings and memory' },
  { name: 'random', sig: 'random()', about: 'a number from 0 to 1, the same every rerun', insert: 'random()', section: 'Settings and memory' },

  { name: 'clamp', sig: 'clamp(x, lo, hi)', about: 'keep a number in a range', insert: 'clamp(, 0, 1)', caret: 7, section: 'Maths' },
  { name: 'lerp', sig: 'lerp(a, b, t)', about: 'a point between two numbers', insert: 'lerp(, , )', caret: 5, section: 'Maths' },
  { name: 'sign', sig: 'sign(x)', about: '-1, 0 or 1', insert: 'sign()', caret: 1, section: 'Maths' },
  { name: 'Math', sig: 'Math.sin, Math.atan2, ...', about: 'the usual, without Math.random', insert: 'Math.', section: 'Maths' },
];

/** The members completion offers after `self.` and `keys.`, and one level down. */
export const API_MEMBERS: Readonly<Record<string, ReadonlyArray<{ name: string; about: string }>>> = {
  self: [
    { name: 'pos', about: 'where the robot is: { x, y } in meters' },
    { name: 'vel', about: 'how fast it moves: { x, y } in meters a second' },
    { name: 'angle', about: 'how far it leans, in radians' },
    { name: 'angVel', about: 'how fast it turns, in radians a second' },
    { name: 'mass', about: 'what it weighs now, in kg' },
    { name: 'energy', about: '{ stored, capacity }' },
  ],
  'self.pos': [
    { name: 'x', about: 'meters, right is more' },
    { name: 'y', about: 'meters, up is more' },
  ],
  'self.vel': [
    { name: 'x', about: 'meters a second to the right' },
    { name: 'y', about: 'meters a second upward' },
  ],
  'self.energy': [
    { name: 'stored', about: 'what it has now' },
    { name: 'capacity', about: 'what it can hold' },
  ],
  keys: [
    { name: 'down', about: 'keys.down("w"): is the key held' },
    { name: 'pressed', about: 'keys.pressed("w"): did it go down this tick' },
    { name: 'released', about: 'keys.released("w"): did it come up this tick' },
  ],
};

/** The name of a part a robot could add to see with, by what the definitions say (the widest look, then the longest). */
export function seerName(registry: PartRegistry): string | undefined {
  return registry
    .list()
    .filter((d) => d.sensor !== undefined)
    .sort((a, b) => (b.sensor?.cone ?? 0) - (a.sensor?.cone ?? 0) || (b.sensor?.range ?? 0) - (a.sensor?.range ?? 0))[0]
    ?.name.toLowerCase();
}

/** Why a section of the API does nothing on this robot, or undefined when it works. */
export function apiDim(entry: ApiEntry, ref: RobotRef, registry: PartRegistry): string | undefined {
  if (entry.needs === 'sees' && !ref.sees) {
    const seer = seerName(registry);
    return `nothing on this robot sees${seer !== undefined ? `: add a part that does, such as a ${seer}` : ''}`;
  }
  if (entry.needs === 'others' && !ref.others) return 'this robot has one core and builds nothing, so there is nobody to send to';
  return undefined;
}

/** The API in its sections, each entry with why it is dimmed on this robot (if it is). */
export function apiSections(ref: RobotRef, registry: PartRegistry): Array<{ section: ApiEntry['section']; dim?: string; entries: ApiEntry[] }> {
  const out: Array<{ section: ApiEntry['section']; dim?: string; entries: ApiEntry[] }> = [];
  for (const e of SCRIPT_API) {
    let s = out.find((x) => x.section === e.section);
    if (!s) out.push((s = { section: e.section, entries: [] }));
    s.entries.push(e);
  }
  for (const s of out) {
    const reasons = s.entries.map((e) => apiDim(e, ref, registry));
    const first = reasons[0];
    if (first !== undefined && reasons.every((r) => r === first)) s.dim = first;
  }
  return out;
}
