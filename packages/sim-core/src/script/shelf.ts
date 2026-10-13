import { assemble } from '../assembly/assemble';
import { addTagToParts, removeTagFromParts, setPartsAuto } from '../blueprint/edit';
import type { Blueprint, CoreControls, PlacedPart, ScriptSpec } from '../blueprint/types';
import { rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';

/**
 * Shared behaviors (M16): a behavior is an ordinary script kept on a shelf (`behaviors/<id>.js` in the repo). Adding
 * one to a robot copies the file into the blueprint as that robot's own script. It finds its parts through slots:
 * each slot is a group (a tag) the builder puts on the parts the owner picked, and says which input those parts must
 * have. A slot is typed by input, never by part type, so a behavior works on parts that did not exist when it was
 * written.
 *
 * What a behavior is, is said in line comments at the top of its file (the header ends at the first line that is
 * not a `//` comment or blank):
 *
 *   // @behavior Hover
 *   // @about Holds a height and stays level, on anything that lifts.
 *   // @version 1
 *   // @slot lift throttle "what lifts" required many owns guess up
 *   // @slot level spin "what levels" optional many
 *   // @needs sensor "something that sees, such as a radar"
 *   // @note Anything worth telling whoever adds it.
 *
 * - `@slot <group> <input>[|<input>...] "<label>" [required|optional] [one|many] [owns] [guess <hint>...]`: parts with
 *   any of the inputs may fill it. `owns`: the behavior drives these parts every tick, so filling the slot takes them
 *   off their auto keys (a key held on an input beats a script). The hints narrow the first guess, never what may
 *   fill it: `up` (it acts upward as built), `has:<output>` (it reports that output), `carries:<slot>` (a joint part
 *   that carries something guessed for that slot), `on:<slot>` (carried by something guessed for that slot).
 * - `@needs <block> "<label>"`: the robot must have a part whose definition has that block (`sensor`: something that
 *   fills `contacts`).
 * - `@from <shelf id> <version> [<sum>]`: only in a copy on a robot: the shelf behavior and version it was copied
 *   from, and a check sum of the text as copied. This is the origin mark. It lives in the copy's own text, so it goes wherever the script goes (the `.js` file, a deploy,
 *   a replay, Save As) with nothing added to the blueprint format.
 *
 * Everything here is pure: text and blueprints in, text and blueprints out.
 */

/** How a slot's first guess is narrowed. */
export type SlotHint = { kind: 'up' } | { kind: 'has'; output: string } | { kind: 'carries'; slot: string } | { kind: 'on'; slot: string };

export interface BehaviorSlot {
  /** The group: the tag the builder puts on the chosen parts, and the name the script looks for. */
  group: string;
  /** A part may fill the slot when it has any of these inputs. */
  inputs: string[];
  /** Plain words for the builder: "what lifts". */
  label: string;
  required: boolean;
  /** Whether several parts make sense (false: one). */
  many: boolean;
  /** The behavior drives these parts every tick: filling the slot takes them off their auto keys. */
  owns: boolean;
  guess: SlotHint[];
}

export interface BehaviorNeed {
  /** A block of a part definition (`sensor`). */
  block: string;
  label: string;
}

export interface BehaviorHeader {
  name: string;
  /** One line about it. '' when the file has none. */
  about: string;
  version: number;
  slots: BehaviorSlot[];
  needs: BehaviorNeed[];
  notes: string[];
  /**
   * In a robot's copy: the shelf behavior it came from (the origin mark). Absent in a shelf file. `sum` is the mark's
   * third word when it has one: a check sum of the text as it was copied (`behaviorEdited`).
   */
  from?: BehaviorOrigin;
}

/** Where a robot's copy came from: its `// @from <shelf id> <version> [<sum>]` line. */
export interface BehaviorOrigin {
  id: string;
  version: number;
  /** A check sum of the copy's text as it left the shelf (`textSum`), so an edit to the copy can be told later. Absent in a mark written without one. */
  sum?: string;
}

export interface BehaviorParse {
  /** Absent when the text has no `@behavior` line: it is an ordinary script. */
  header?: BehaviorHeader;
  /** What is wrong with the header, in plain words with the line number. Empty for a good one. */
  problems: string[];
}

const WORD = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A slot line's words, with a quoted label as one word. */
function words(text: string): { word: string; quoted: boolean }[] {
  const out: { word: string; quoted: boolean }[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] !== undefined ? { word: m[1], quoted: true } : { word: m[2] as string, quoted: false });
  return out;
}

function parseHint(word: string): SlotHint | undefined {
  if (word === 'up') return { kind: 'up' };
  const m = /^(has|carries|on):(.+)$/.exec(word);
  if (!m) return undefined;
  const value = m[2] as string;
  if (m[1] === 'has') return { kind: 'has', output: value };
  return m[1] === 'carries' ? { kind: 'carries', slot: value } : { kind: 'on', slot: value };
}

function parseSlot(text: string, at: string, problems: string[]): BehaviorSlot | undefined {
  const w = words(text);
  const group = w[0];
  const inputs = w[1];
  const label = w[2];
  if (!group || !inputs || !label || group.quoted || inputs.quoted || !label.quoted) {
    problems.push(`${at}: a slot is written @slot <group> <input> "<label>", then optionally required or optional, one or many, owns, and guess with its hints`);
    return undefined;
  }
  if (!WORD.test(group.word)) {
    problems.push(`${at}: the group '${group.word}' must be letters, digits, - or _, starting with a letter`);
    return undefined;
  }
  const names = inputs.word.split('|');
  if (names.some((n) => !WORD.test(n))) {
    problems.push(`${at}: '${inputs.word}' is not an input name (several are written throttle|speed)`);
    return undefined;
  }
  const slot: BehaviorSlot = { group: group.word, inputs: names, label: label.word, required: true, many: true, owns: false, guess: [] };
  let guessing = false;
  for (const { word } of w.slice(3)) {
    if (guessing) {
      const hint = parseHint(word);
      if (hint) slot.guess.push(hint);
      else problems.push(`${at}: '${word}' is not a guess hint (up, has:<output>, carries:<slot>, on:<slot>)`);
    } else if (word === 'required' || word === 'optional') slot.required = word === 'required';
    else if (word === 'one' || word === 'many') slot.many = word === 'many';
    else if (word === 'owns') slot.owns = true;
    else if (word === 'guess') guessing = true;
    else problems.push(`${at}: '${word}' is not known here (required, optional, one, many, owns, guess)`);
  }
  return slot;
}

/**
 * Reads the header of a behavior file (or of a robot's copy of one). Only the comment lines at the top are read; the
 * code is not looked at. Unknown `@` lines are reported and skipped, so a newer file still reads in an older build.
 */
export function parseBehaviorHeader(source: string): BehaviorParse {
  const problems: string[] = [];
  let name: string | undefined;
  let about = '';
  let version: number | undefined;
  let from: BehaviorOrigin | undefined;
  const slots: BehaviorSlot[] = [];
  const needs: BehaviorNeed[] = [];
  const notes: string[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === '') continue;
    if (!line.startsWith('//')) break;
    const m = /^\/\/\s*@([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as string;
    const rest = (m[2] as string).trim();
    const at = `line ${i + 1}`;
    if (key === 'behavior') {
      if (rest === '') problems.push(`${at}: @behavior needs a name`);
      else name = rest;
    } else if (key === 'about') about = rest;
    else if (key === 'version') {
      if (/^[1-9][0-9]*$/.test(rest)) version = Number(rest);
      else problems.push(`${at}: @version must be a whole number from 1 up, not '${rest}'`);
    } else if (key === 'slot') {
      const slot = parseSlot(rest, at, problems);
      if (slot && slots.some((s) => s.group === slot.group)) problems.push(`${at}: the group '${slot.group}' is used by two slots`);
      else if (slot) slots.push(slot);
    } else if (key === 'needs') {
      const w = words(rest);
      const block = w[0];
      const label = w[1];
      if (!block || !label || block.quoted || !label.quoted || w.length > 2) problems.push(`${at}: a need is written @needs <block> "<label>"`);
      else needs.push({ block: block.word, label: label.word });
    } else if (key === 'note') {
      if (rest !== '') notes.push(rest);
    } else if (key === 'from') {
      const f = /^([a-z0-9][a-z0-9-]*)\s+([1-9][0-9]*)(?:\s+([0-9a-f]{8}))?$/.exec(rest);
      if (f) from = { id: f[1] as string, version: Number(f[2]), ...(f[3] !== undefined ? { sum: f[3] } : {}) };
      else problems.push(`${at}: @from is written @from <shelf id> <version>`);
    } else problems.push(`${at}: @${key} is not known (behavior, about, version, slot, needs, note, from)`);
  }
  if (name === undefined) return { problems: problems.length > 0 ? ['there is no @behavior line: this is an ordinary script', ...problems] : [] };
  if (version === undefined) {
    if (!problems.some((p) => p.includes('@version'))) problems.push('there is no @version line');
    version = 1;
  }
  for (const s of slots) {
    for (const h of s.guess) {
      if ((h.kind === 'carries' || h.kind === 'on') && !slots.some((o) => o.group === h.slot)) problems.push(`slot ${s.group}: the hint ${h.kind}:${h.slot} names a slot this behavior does not have`);
    }
  }
  const header: BehaviorHeader = { name, about, version, slots, needs, notes };
  if (from) header.from = from;
  return { header, problems };
}

/** A shelf file's id: `behaviors/aim-and-fire.js` is `aim-and-fire`. */
export function behaviorId(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).replace(/\.js$/, '');
}

/** The shelf behavior and version a robot's script was copied from (its `@from` line), if it is such a copy. */
export function behaviorOrigin(source: string): BehaviorOrigin | undefined {
  return parseBehaviorHeader(source).header?.from;
}

/** A behavior's text without its `@from` line (the header's only), line ends as `\n`, and no blank lines at the end. */
function unmarked(source: string): string {
  const out: string[] = [];
  let inHeader = true;
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (inHeader && t !== '' && !t.startsWith('//')) inHeader = false;
    if (inHeader && /^\/\/\s*@from\b/.test(t)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n+$/, '');
}

/** A short check sum of a text (FNV-1a, 32 bits, eight hex digits). Not for secrets: only to tell "the same text" from "edited". */
export function textSum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Whether a robot's copy of a behavior was edited since it left the shelf: its text (without the `@from` line) no
 * longer has the check sum its mark carries. Undefined when the text is not a copy, or its mark carries no sum (then
 * nothing can be said).
 */
export function behaviorEdited(source: string): boolean | undefined {
  const from = behaviorOrigin(source);
  if (!from || from.sum === undefined) return undefined;
  return textSum(unmarked(source)) !== from.sum;
}

/**
 * The text a robot gets when a shelf behavior is added to it: the shelf file with the origin mark, `// @from <id>
 * <version> <sum>`, on the line after `@version` (replacing a mark the text already had). The sum is of the text as
 * copied (`textSum`), so the builder can tell later whether the robot's copy was edited (`behaviorEdited`). Text
 * without a behavior header is given back as it is.
 */
export function behaviorCopy(shelfId: string, source: string): string {
  const header = parseBehaviorHeader(source).header;
  if (!header) return source;
  const mark = `// @from ${shelfId} ${header.version} ${textSum(unmarked(source))}`;
  const out: string[] = [];
  let placed = false;
  let inHeader = true;
  const lines = source.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (inHeader && t !== '' && !t.startsWith('//')) inHeader = false;
    if (inHeader && /^\/\/\s*@from\b/.test(t)) continue;
    out.push(line);
    if (inHeader && !placed && /^\/\/\s*@version\b/.test(t)) {
      out.push(mark);
      placed = true;
    }
  }
  if (!placed) {
    // No @version line (the parser said so): the mark goes right under @behavior.
    const k = out.findIndex((l) => /^\s*\/\/\s*@behavior\b/.test(l));
    out.splice(k + 1, 0, mark);
  }
  return out.join('\n');
}

export interface SlotFit {
  slot: BehaviorSlot;
  /** The tag the slot writes on this robot: the group, or `<scope>.<group>` for a placed copy's own core. */
  tag: string;
  /** Ids of the parts that may fill it (they have one of its inputs), in blueprint order. */
  could: string[];
  /** The best first guess of which should: a subset of `could`, at most one for a slot of one. May be empty. */
  guess: string[];
  /** Ids of the parts already in the group. */
  filled: string[];
  /** Why the behavior cannot work, when the slot is required and nothing may fill it. */
  problem?: string;
}

export interface BehaviorFit {
  /** False when the behavior cannot work on this robot: `problems` says why. */
  ok: boolean;
  slots: SlotFit[];
  needs: { need: BehaviorNeed; met: boolean }[];
  /** Plain reasons, each fit to follow the behavior's name: "needs something with a throttle input". */
  problems: string[];
}

export interface FitOptions {
  /** The core whose script the behavior is (a part id in `cores`): its slots live in that core's scope. Absent: the primary core. */
  core?: string;
}

function scopeOf(bp: Blueprint, core: string | undefined): string | undefined {
  return core === undefined ? undefined : bp.cores?.find((c) => c.core === core)?.scope;
}

/** A part's joint carrier, by part id, as scripts read it in `part.on` ('' for none). Empty when the blueprint cannot be assembled. */
function carriers(bp: Blueprint, registry: PartRegistry): Map<string, string> {
  const out = new Map<string, string>();
  if (bp.parts.some((p) => !registry.has(p.part))) return out;
  let groups;
  try {
    groups = assemble(bp, registry).groups;
  } catch {
    return out;
  }
  for (const g of groups) {
    for (const id of g.partIds) {
      if (!g.joint) out.set(id, '');
      else if (g.joint.partId !== id) out.set(id, g.joint.partId);
      else out.set(id, groups[g.joint.parentGroup]?.joint?.partId ?? '');
    }
  }
  return out;
}

/** Every joint part between a part and the robot's main body, nearest first. */
function chain(id: string, on: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (let at = on.get(id) ?? ''; at !== '' && !out.includes(at); at = on.get(at) ?? '') out.push(at);
  return out;
}

/**
 * For each slot of a behavior: the parts of this robot that could fill it, a first guess of which should, and the
 * ones already in its group; and whether the behavior can work here at all. Read off the parts' inputs, outputs, how
 * they were built turned, and what carries what; never off a part's type name.
 *
 * - `could`: parts with one of the slot's inputs. For a placed copy's own core (`opts.core` with a scope), only that
 *   copy's parts.
 * - `guess`: `could` narrowed by the slot's hints. For the primary core, parts of a placed copy that has its own core
 *   are left out of the guess (a missile on a rail has thrusters, and the drone's Hover should not take them), though
 *   they stay in `could`.
 */
export function fitBehavior(bp: Blueprint, registry: PartRegistry, header: BehaviorHeader, opts: FitOptions = {}): BehaviorFit {
  const scope = scopeOf(bp, opts.core);
  const otherScopes = (bp.cores ?? []).map((c: CoreControls) => c.scope).filter((s): s is string => s !== undefined && s !== scope);
  const inScope = (p: PlacedPart): boolean => scope === undefined || p.tags.includes(scope);
  const foreign = (p: PlacedPart): boolean => scope === undefined && otherScopes.some((s) => p.tags.includes(s));
  const def = (p: PlacedPart) => (registry.has(p.part) ? registry.get(p.part) : undefined);
  const on = carriers(bp, registry);

  const could = new Map<string, PlacedPart[]>();
  const base = new Map<string, PlacedPart[]>();
  for (const slot of header.slots) {
    const list = bp.parts.filter((p) => inScope(p) && (def(p)?.inputs.some((c) => slot.inputs.includes(c.name)) ?? false));
    could.set(slot.group, list);
    base.set(
      slot.group,
      list.filter((p) => {
        if (foreign(p)) return false;
        const d = def(p);
        for (const h of slot.guess) {
          if (h.kind === 'up' && !(d?.acts !== undefined && rotateFace(d.acts, p.rot) === 'N')) return false;
          if (h.kind === 'has' && !(d?.outputs.some((o) => o.name === h.output) ?? false)) return false;
        }
        return true;
      }),
    );
  }
  const slots: SlotFit[] = header.slots.map((slot) => {
    const tag = scope === undefined ? slot.group : `${scope}.${slot.group}`;
    let guess = base.get(slot.group) ?? [];
    for (const h of slot.guess) {
      const other = h.kind === 'carries' || h.kind === 'on' ? (base.get(h.slot) ?? []) : [];
      if (h.kind === 'carries') {
        const carrying = new Set(other.flatMap((p) => chain(p.id, on)));
        guess = guess.filter((p) => carrying.has(p.id));
      } else if (h.kind === 'on') {
        const ids = new Set(other.map((p) => p.id));
        guess = guess.filter((p) => chain(p.id, on).some((id) => ids.has(id)));
      }
    }
    if (!slot.many) guess = guess.slice(0, 1);
    const list = could.get(slot.group) ?? [];
    const fit: SlotFit = { slot, tag, could: list.map((p) => p.id), guess: guess.map((p) => p.id), filled: bp.parts.filter((p) => p.tags.includes(tag)).map((p) => p.id) };
    if (slot.required && list.length === 0) fit.problem = `needs something with ${slot.inputs.length === 1 ? `a ${slot.inputs[0]} input` : `one of these inputs: ${slot.inputs.join(', ')}`}`;
    return fit;
  });
  const needs = header.needs.map((need) => ({ need, met: bp.parts.some((p) => inScope(p) && (def(p) as unknown as Record<string, unknown> | undefined)?.[need.block] !== undefined) }));
  const problems = [...slots.flatMap((s) => (s.problem !== undefined ? [s.problem] : [])), ...needs.filter((n) => !n.met).map((n) => `needs ${n.need.label}`)];
  return { ok: problems.length === 0, slots, needs, problems };
}

/**
 * Fills a slot: the slot's group becomes exactly the given parts (the tag is added to them and taken off any other
 * part that had it), and when the slot `owns` its parts they are taken off their auto keys. Ids the blueprint does not
 * have, or parts without any of the slot's inputs, are skipped. `opts.core` as in `fitBehavior`. The same blueprint
 * object comes back when nothing changed.
 */
export function fillSlot(bp: Blueprint, registry: PartRegistry, slot: BehaviorSlot, ids: readonly string[], opts: FitOptions = {}): Blueprint {
  const scope = scopeOf(bp, opts.core);
  const tag = scope === undefined ? slot.group : `${scope}.${slot.group}`;
  const fits = (p: PlacedPart): boolean => (scope === undefined || p.tags.includes(scope)) && registry.has(p.part) && registry.get(p.part).inputs.some((c) => slot.inputs.includes(c.name));
  const chosen = bp.parts.filter((p) => ids.includes(p.id) && fits(p)).map((p) => p.id);
  const drop = bp.parts.filter((p) => p.tags.includes(tag) && !chosen.includes(p.id)).map((p) => p.id);
  const add = bp.parts.filter((p) => chosen.includes(p.id) && !p.tags.includes(tag)).map((p) => p.id);
  const takeAuto = slot.owns ? bp.parts.filter((p) => chosen.includes(p.id) && p.auto !== false).map((p) => p.id) : [];
  if (drop.length === 0 && add.length === 0 && takeAuto.length === 0) return bp;
  let out = bp;
  if (drop.length > 0) out = removeTagFromParts(out, drop, tag);
  if (add.length > 0) out = addTagToParts(out, add, tag);
  if (takeAuto.length > 0) out = setPartsAuto(out, takeAuto, false);
  return out;
}

export interface AttachOptions extends FitOptions {
  /** The script's id on the robot. Absent: the shelf id, with a number when that is taken (`hover-2`). */
  scriptId?: string;
  /** Whether it runs from deploy. Absent: on. */
  enabled?: boolean;
}

export type AttachResult = { ok: true; blueprint: Blueprint; scriptId: string } | { ok: false; error: string };

/**
 * Adds a shelf behavior to a robot: a new script entry whose code is the robot's own copy of the shelf file
 * (`behaviorCopy`: the file with its `@from` mark). It has no file yet, so the next save writes it next to the
 * blueprint under the robot's name (`drone.hover.js`, `assignScriptFiles`), and editing it never touches the shelf or
 * another robot. Slots are filled separately (`fitBehavior`, then `fillSlot`). Refused when the text is not a
 * behavior, when `opts.core` is not a core with controls of its own, or when `opts.scriptId` is taken.
 */
export function attachBehavior(bp: Blueprint, shelfId: string, source: string, opts: AttachOptions = {}): AttachResult {
  const parsed = parseBehaviorHeader(source);
  if (!parsed.header) return { ok: false, error: `${shelfId} is not a behavior: it has no @behavior line` };
  const entry = opts.core === undefined || opts.core === bp.primaryCore ? undefined : bp.cores?.find((c) => c.core === opts.core);
  if (opts.core !== undefined && opts.core !== bp.primaryCore && !entry) return { ok: false, error: `${opts.core} is not a core with controls of its own in this blueprint` };
  const list = entry ? entry.scripts : bp.scripts;
  const taken = new Set(list.map((s) => s.id));
  let scriptId = opts.scriptId ?? shelfId;
  if (opts.scriptId !== undefined && taken.has(scriptId)) return { ok: false, error: `this robot already has a script called '${scriptId}'` };
  for (let n = 2; taken.has(scriptId); n++) scriptId = `${shelfId}-${n}`;
  const script: ScriptSpec = { id: scriptId, enabled: opts.enabled ?? true, params: {}, source: behaviorCopy(shelfId, source) };
  if (!entry) return { ok: true, blueprint: { ...bp, scripts: [...bp.scripts, script] }, scriptId };
  return { ok: true, blueprint: { ...bp, cores: (bp.cores ?? []).map((c) => (c === entry ? { ...c, scripts: [...c.scripts, script] } : c)) }, scriptId };
}
