import {
  attachBehavior,
  behaviorCopy,
  behaviorEdited,
  behaviorId,
  fillSlot,
  fitBehavior,
  parseBehaviorHeader,
  readScript,
  removeTagFromParts,
  rootPartId,
  scriptRuns,
  setPartsAuto,
  type BehaviorFit,
  type BehaviorHeader,
  type BehaviorSlot,
  type Blueprint,
  type PartRegistry,
  type ScriptSpec,
} from '@robots/sim-core';
import { countParts, typeName } from './boardOps';
import { controlsOf, withControls } from './coreControls';
import type { NoteLine } from './notice';
import { removeScript, updateScript } from './scripts';

/**
 * The shelf of shared behaviors in the builder (M16, plan section 5): what is on it and whether each can work on this
 * robot, adding one by filling its slots one at a time, what a behavior's card shows, and the update and remove that
 * go with it. All pure: blueprints and text in, blueprints and text out. The engine half (the header, the fit, the
 * copy and its mark) is `sim-core/src/script/shelf.ts`; this never reads a part's type name to decide anything.
 */

/** One file of the shelf (`behaviors/hover.js`), read. */
export interface ShelfEntry {
  /** `hover`: the file name without `.js`. */
  id: string;
  source: string;
  header: BehaviorHeader;
  /** What is wrong with its header, in plain words. Empty for a good one. */
  problems: string[];
}

/** The shelf from its files. A file with no `@behavior` line is not a behavior and is left out. Sorted by name. */
export function readShelf(files: ReadonlyArray<{ file: string; text: string }>): ShelfEntry[] {
  const out: ShelfEntry[] = [];
  for (const f of files) {
    const parsed = parseBehaviorHeader(f.text);
    if (parsed.header) out.push({ id: behaviorId(f.file), source: f.text, header: parsed.header, problems: parsed.problems });
  }
  return out.sort((a, b) => a.header.name.localeCompare(b.header.name));
}

/** A shelf behavior as "Add a behavior" lists it for one robot. */
export interface ShelfOffer {
  entry: ShelfEntry;
  /** Whether it can work on this robot. */
  ok: boolean;
  /** Why not, in words that follow its name: "needs something with a throttle input". */
  reason?: string;
  fit: BehaviorFit;
  /** The ids of this core's scripts that are copies of it already. */
  here: string[];
}

function scriptsOf(bp: Blueprint, registry: PartRegistry, core: string | undefined): readonly ScriptSpec[] {
  return controlsOf(bp, registry, core).scripts;
}

/** The core a behavior of the panels' core is attached to, as `fitBehavior` and `attachBehavior` want it: absent for the main core. */
function coreOpt(bp: Blueprint, registry: PartRegistry, core: string | undefined): { core?: string } {
  return core === undefined || core === rootPartId(bp, registry) ? {} : { core };
}

/** Every shelf behavior, and whether it can work on this robot (under the core the panels are on). */
export function shelfOffers(bp: Blueprint, registry: PartRegistry, shelf: readonly ShelfEntry[], core?: string): ShelfOffer[] {
  const scripts = scriptsOf(bp, registry, core);
  return shelf.map((entry) => {
    const fit = fitBehavior(bp, registry, entry.header, coreOpt(bp, registry, core));
    const here = scripts.filter((s) => typeof s.source === 'string' && parseBehaviorHeader(s.source).header?.from?.id === entry.id).map((s) => s.id);
    return { entry, ok: fit.ok, ...(fit.ok ? {} : { reason: fit.problems.join('; ') }), fit, here };
  });
}

/** One slot being filled. */
export interface FillSlot {
  slot: BehaviorSlot;
  /** The tag it writes (the group, or `<scope>.<group>`). */
  tag: string;
  /** Parts that may fill it: only these can be clicked. */
  could: string[];
  /** The builder's first guess. */
  guess: string[];
  /** What is picked now. */
  chosen: string[];
  /** In the group before this began. */
  before: string[];
  /** Left as it was (an optional slot the player skipped). */
  skipped: boolean;
}

/**
 * Slot filling in progress: a behavior being added (every slot in turn), or one slot of a behavior already on the
 * robot being changed. Nothing in the blueprint changes until `finishFill`.
 */
export interface FillState {
  mode: 'add' | 'change';
  /** The behavior's name, for the sentences. */
  name: string;
  /** Adding: the shelf behavior and its text. */
  shelfId?: string;
  source?: string;
  /** Changing: the script on the robot. */
  scriptId?: string;
  /** The core it is (or will be) a script of; absent for the main core. */
  core?: string;
  slots: FillSlot[];
  /** The slot being filled now. `slots.length` when every slot is done. */
  index: number;
}

function fillSlots(fit: BehaviorFit, only?: string): FillSlot[] {
  return fit.slots
    .filter((s) => (only === undefined ? s.could.length > 0 : s.slot.group === only))
    .map((s) => {
      // A group that is there already (the behavior was on this robot before) is a better start than a guess.
      const start = s.filled.filter((id) => s.could.includes(id));
      const chosen = start.length > 0 ? start : s.guess;
      return { slot: s.slot, tag: s.tag, could: s.could, guess: s.guess, chosen: s.slot.many ? chosen : chosen.slice(0, 1), before: s.filled, skipped: false };
    });
}

/** Starts adding a shelf behavior: its slots that something on the robot could fill, each with the guess picked. */
export function startFill(bp: Blueprint, registry: PartRegistry, entry: ShelfEntry, core?: string): FillState | { error: string } {
  const opt = coreOpt(bp, registry, core);
  const fit = fitBehavior(bp, registry, entry.header, opt);
  if (!fit.ok) return { error: `${entry.header.name} ${fit.problems.join('; ')}.` };
  return { mode: 'add', name: entry.header.name, shelfId: entry.id, source: entry.source, ...opt, slots: fillSlots(fit), index: 0 };
}

/** Starts changing one slot of a behavior already on the robot: what is in its group now is picked. */
export function startChange(bp: Blueprint, registry: PartRegistry, core: string | undefined, scriptId: string, group: string): FillState | { error: string } {
  const script = scriptsOf(bp, registry, core).find((s) => s.id === scriptId);
  const header = typeof script?.source === 'string' ? parseBehaviorHeader(script.source).header : undefined;
  if (!header) return { error: `'${scriptId}' is not a behavior with slots.` };
  const opt = coreOpt(bp, registry, core);
  const slots = fillSlots(fitBehavior(bp, registry, header, opt), group).map((s) => ({ ...s, chosen: s.before.filter((id) => s.could.includes(id)) }));
  const first = slots[0];
  if (!first) return { error: `${header.name} has no slot called '${group}'.` };
  if (first.could.length === 0) return { error: `Nothing on this robot has ${inputWords(first.slot)}, so nothing can be ${quoted(first.slot)}.` };
  return { mode: 'change', name: header.name, scriptId, ...opt, slots, index: 0 };
}

const quoted = (slot: BehaviorSlot): string => `"${slot.label}"`;
const inputWords = (slot: BehaviorSlot): string => (slot.inputs.length === 1 ? `a ${slot.inputs[0]} input` : `one of the inputs ${slot.inputs.join(', ')}`);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const these = (n: number): string => (n === 1 ? 'This part' : `These ${n} parts`);

/** The slot being filled, or undefined when all are done. */
export function fillCurrent(state: FillState): FillSlot | undefined {
  return state.slots[state.index];
}

export function fillDone(state: FillState): boolean {
  return state.index >= state.slots.length;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The sentence for the slot being filled: "What lifts? These 4 parts look right." while the guess stands, the count
 * once the player changed it, and what to do when there was nothing to guess.
 */
export function fillSentence(state: FillState): string {
  const s = fillCurrent(state);
  if (!s) return '';
  const ask = `${cap(s.slot.label)}?`;
  const n = s.chosen.length;
  if (n === 0) return `${ask} Click ${s.slot.many ? 'the parts' : 'the part'} on the board: ${s.could.length === 1 ? '1 part could' : `${s.could.length} parts could`}.`;
  if (state.mode === 'add' && sameSet(s.chosen, s.guess)) return `${ask} ${these(n)} ${n === 1 ? 'looks' : 'look'} right.`;
  if (state.mode === 'change' && sameSet(s.chosen, s.before)) return `${ask} ${these(n)} now.`;
  return `${ask} ${n === 1 ? '1 part' : `${n} parts`} picked.`;
}

/** What a click on the board does while a slot is being filled, in a few words (under the sentence). */
export function fillHelp(state: FillState): string {
  const s = fillCurrent(state);
  if (!s) return '';
  const who = `Only parts with ${inputWords(s.slot)} can be picked`;
  return s.slot.many ? `Click a part to add it or take it out. ${who}.` : `Click a part to pick it instead. ${who}.`;
}

/**
 * A click on a part while a slot is being filled: it joins the slot or leaves it (a slot of one takes it instead of
 * the one it had). A part that cannot fill the slot is refused, with the reason.
 */
export function fillToggle(state: FillState, bp: Blueprint, registry: PartRegistry, partId: string): { state: FillState; refused?: string } {
  const s = fillCurrent(state);
  if (!s) return { state };
  if (!s.could.includes(partId)) {
    const part = bp.parts.find((p) => p.id === partId);
    const what = part ? `A ${typeName(registry, part.part)}` : 'That part';
    return { state, refused: `${what} has no ${s.slot.inputs.join(' or ')} input, so it cannot be ${quoted(s.slot)}.` };
  }
  const chosen = s.chosen.includes(partId) ? s.chosen.filter((id) => id !== partId) : s.slot.many ? s.could.filter((id) => id === partId || s.chosen.includes(id)) : [partId];
  return { state: { ...state, slots: state.slots.map((x, i) => (i === state.index ? { ...x, chosen, skipped: false } : x)) } };
}

/** Accept: the slot is as picked, on to the next. A required slot with nothing picked is refused. */
export function fillAccept(state: FillState): { state: FillState; refused?: string } {
  const s = fillCurrent(state);
  if (!s) return { state };
  if (s.chosen.length === 0 && s.slot.required) return { state, refused: `${state.name} needs ${quoted(s.slot)}: pick at least one part, or cancel.` };
  return { state: { ...state, index: state.index + 1 } };
}

/** Skip an optional slot: it is left exactly as it was. Refused for a required one. */
export function fillSkip(state: FillState): { state: FillState; refused?: string } {
  const s = fillCurrent(state);
  if (!s) return { state };
  if (s.slot.required) return { state, refused: `${state.name} needs ${quoted(s.slot)}: it cannot be skipped.` };
  return { state: { ...state, slots: state.slots.map((x, i) => (i === state.index ? { ...x, skipped: true } : x)), index: state.index + 1 } };
}

/** Back to the slot before, to pick again. */
export function fillBack(state: FillState): FillState {
  return state.index > 0 ? { ...state, index: state.index - 1 } : state;
}

/** "it" for one part, "them" for more. */
const them = (n: number): string => (n === 1 ? 'it' : 'them');

/**
 * Slot filling finished: the blueprint with the behavior attached (when adding) and every slot's group written, as
 * ONE blueprint, so it is one undo step; and what to say after it. Filling a slot that owns its parts takes them off
 * their auto keys (`fillSlot`); a part taken out of such a slot gets its own keys back, so it is never left with
 * nothing driving it.
 */
export function finishFill(bp: Blueprint, registry: PartRegistry, state: FillState): { ok: true; bp: Blueprint; scriptId: string; lines: NoteLine[] } | { ok: false; error: string } {
  const opt = state.core !== undefined ? { core: state.core } : {};
  let out = bp;
  let scriptId = state.scriptId ?? '';
  if (state.mode === 'add') {
    const attached = attachBehavior(out, state.shelfId ?? '', state.source ?? '', opt);
    if (!attached.ok) return { ok: false, error: attached.error };
    out = attached.blueprint;
    scriptId = attached.scriptId;
  }
  const typeOf = (id: string): string => bp.parts.find((p) => p.id === id)?.part ?? '';
  const hadAuto = (id: string): boolean => bp.parts.find((p) => p.id === id)?.auto !== false;
  const driven: string[] = [];
  const keysOff: string[] = [];
  const keysBack: string[] = [];
  const lines: NoteLine[] = [];
  for (const s of state.slots) {
    if (s.skipped) continue;
    out = fillSlot(out, registry, s.slot, s.chosen, opt);
    for (const id of s.chosen) if (!driven.includes(id)) driven.push(id);
    if (!s.slot.owns) continue;
    for (const id of s.chosen) if (hadAuto(id) && !keysOff.includes(id)) keysOff.push(id);
    // Taken out of a slot that owned it: nothing drives it now, so its own keys come back.
    const dropped = s.before.filter((id) => !s.chosen.includes(id) && !hadAuto(id));
    if (dropped.length > 0) {
      out = setPartsAuto(out, dropped, true);
      keysBack.push(...dropped);
    }
  }
  const kinds = (ids: readonly string[]): string => countParts(registry, ids.map(typeOf));
  const off = keysOff.length === 0 ? '' : sameSet(keysOff, driven) ? (keysOff.length === 1 ? ' Its own key is off.' : ' Their own keys are off.') : ` The own keys of ${kinds(keysOff)} are off: ${state.name} drives ${them(keysOff.length)} every tick.`;
  if (state.mode === 'add') {
    lines.push({ text: driven.length > 0 ? `${state.name} now drives ${kinds(driven)}.${off}` : `${state.name} is on this robot. None of its slots is filled yet.` });
  } else {
    const s = state.slots[0];
    if (s) lines.push({ text: s.chosen.length > 0 ? `${state.name}: ${quoted(s.slot)} is now ${kinds(s.chosen)}.${off}` : `${state.name}: ${quoted(s.slot)} is empty now.` });
  }
  if (keysBack.length > 0) lines.push({ text: `${cap(kinds(keysBack))} taken out ${keysBack.length === 1 ? 'has its own key' : 'have their own keys'} back.` });
  for (const s of state.slots) {
    if (!s.skipped && s.chosen.length > 0) continue;
    if (state.mode === 'add' && !s.slot.required) lines.push({ text: `${quoted(s.slot)} is ${s.skipped && s.before.length > 0 ? 'left as it was' : 'empty'}. Its card can fill it later.` });
  }
  return { ok: true, bp: out, scriptId, lines };
}

/** One `param()` of a script, read off its text. */
export interface ParamInfo {
  name: string;
  default: number;
  min?: number;
  max?: number;
  /** The comment after the `param(...)` on its line: what the number means. */
  help?: string;
}

/**
 * The `param('name', default, { min, max })` calls a script writes with plain values, in order, each with the comment
 * that follows it on its line. The sandbox knows the real list (it runs the code); this adds the words, and stands in
 * for it before the sandbox has answered.
 */
export function scriptParams(source: string): ParamInfo[] {
  const out: ParamInfo[] = [];
  const num = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e-?\\d+)?)';
  const re = new RegExp(`\\bparam\\(\\s*(['"])([^'"\\n]+)\\1\\s*,\\s*${num}\\s*(?:,\\s*\\{([^}\\n]*)\\})?\\s*\\)`);
  for (const raw of source.split('\n')) {
    // A line that is only a comment declares nothing.
    if (/^\s*\/\//.test(raw)) continue;
    const m = re.exec(raw);
    if (!m || out.some((p) => p.name === m[2])) continue;
    const info: ParamInfo = { name: m[2] as string, default: Number(m[3]) };
    const opts = m[4] ?? '';
    const min = new RegExp(`\\bmin\\s*:\\s*${num}`).exec(opts);
    const max = new RegExp(`\\bmax\\s*:\\s*${num}`).exec(opts);
    if (min) info.min = Number(min[1]);
    if (max) info.max = Number(max[1]);
    const comment = /\/\/\s*(.+?)\s*$/.exec(raw.slice(m.index + m[0].length));
    if (comment) info.help = comment[1] as string;
    out.push(info);
  }
  return out;
}

/**
 * The range a param's slider runs over: its own `min` and `max`, and where it has none, a range around its default
 * wide enough to be useful (0 to twice the default; -1 to 1 around nothing). The value it has is always inside.
 */
export function sliderRange(p: { default: number; min?: number; max?: number }, value: number): { min: number; max: number; step: number } {
  const d = p.default;
  let min = p.min ?? Math.min(0, d * 2, value);
  let max = p.max ?? Math.max(d === 0 ? 1 : Math.abs(d) * 2, value);
  if (p.min === undefined && d === 0) min = Math.min(min, -1);
  min = Math.min(min, value);
  max = Math.max(max, value);
  if (max <= min) max = min + 1;
  // About two hundred steps, on a round number.
  const rough = (max - min) / 200;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= rough * 0.999) ?? rough;
  return { min, max, step: Number(step.toPrecision(6)) };
}

/** A slot on a behavior's card. */
export interface CardSlot {
  slot: BehaviorSlot;
  tag: string;
  /** The parts in its group now. */
  filled: string[];
  /** How many parts could fill it. 0: "change" has nothing to offer. */
  could: number;
}

/** One script of the robot as the Behaviors tab shows it. */
export interface BehaviorCard {
  id: string;
  enabled: boolean;
  file?: string;
  /** Its code is loaded. False for a script whose file was not found. */
  loaded: boolean;
  /** Its behavior header, when its text has one (a copy from the shelf, or a script written as a behavior). */
  header?: BehaviorHeader;
  /** Where it came from, when it is a copy from the shelf. */
  from?: {
    id: string;
    version: number;
    /** The shelf's version, when it is newer than the copy's. */
    newer?: number;
    /** The shelf no longer has it. */
    gone: boolean;
    /** The copy was edited since it left the shelf. Undefined when that cannot be told. */
    edited?: boolean;
  };
  slots: CardSlot[];
  /** The key that switches it on and off (its `script` binding), if it has one. */
  key?: string;
  params: ParamInfo[];
  /** Why it will not do its job as it stands: a required slot with nothing in it, a need the robot no longer meets. */
  problems: string[];
}

/** The cards of the scripts of one core, in order. */
export function behaviorCards(bp: Blueprint, registry: PartRegistry, shelf: readonly ShelfEntry[], core?: string): BehaviorCard[] {
  const controls = controlsOf(bp, registry, core);
  const opt = coreOpt(bp, registry, core);
  return controls.scripts.map((s) => {
    const source = typeof s.source === 'string' ? s.source : undefined;
    const header = source !== undefined ? parseBehaviorHeader(source).header : undefined;
    const card: BehaviorCard = { id: s.id, enabled: s.enabled, loaded: source !== undefined, slots: [], params: source !== undefined ? scriptParams(source) : [], problems: [] };
    if (s.file !== undefined) card.file = s.file;
    const key = controls.bindings.find((b) => b.mode === 'script' && b.script === s.id)?.key;
    if (key !== undefined) card.key = key;
    if (!header || source === undefined) return card;
    card.header = header;
    if (header.from) {
      const entry = shelf.find((e) => e.id === header.from?.id);
      const edited = behaviorEdited(source);
      card.from = { id: header.from.id, version: header.from.version, gone: !entry, ...(entry && entry.header.version > header.from.version ? { newer: entry.header.version } : {}), ...(edited !== undefined ? { edited } : {}) };
    }
    const fit = fitBehavior(bp, registry, header, opt);
    card.slots = fit.slots.map((f) => ({ slot: f.slot, tag: f.tag, filled: f.filled, could: f.could.length }));
    for (const f of fit.slots) if (f.slot.required && f.filled.length === 0) card.problems.push(`${quoted(f.slot)} is empty, so it does nothing yet.`);
    for (const n of fit.needs) if (!n.met) card.problems.push(`It needs ${n.need.label}.`);
    return card;
  });
}

/** "4 propellers", "2 parts" for a mix, "nothing yet". */
export function slotText(bp: Blueprint, registry: PartRegistry, slot: CardSlot): string {
  if (slot.filled.length === 0) return 'nothing yet';
  return countParts(registry, slot.filled.map((id) => bp.parts.find((p) => p.id === id)?.part ?? ''));
}

/** One line of a comparison of two texts. */
export interface DiffLine {
  kind: 'same' | 'del' | 'add';
  text: string;
  /** Its line number in the old text (same, del) and in the new one (same, add), from 1. */
  a?: number;
  b?: number;
}

/** The lines of `a` and `b` set against each other (a longest common run of lines kept, the rest taken out or put in). */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  // lcs[i][j]: the longest run of lines x[i..] and y[j..] share.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) (lcs[i] as number[])[j] = x[i] === y[j] ? ((lcs[i + 1] as number[])[j + 1] as number) + 1 : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) out.push({ kind: 'same', text: x[i++] as string, a: i, b: ++j });
    else if (j >= m || (i < n && ((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number))) out.push({ kind: 'del', text: x[i++] as string, a: i });
    else out.push({ kind: 'add', text: y[j++] as string, b: j });
  }
  return out;
}

/** A comparison cut down to what changed, with a few lines around each change; `gap` stands for the lines left out. */
export function diffHunks(diff: readonly DiffLine[], context = 2): Array<DiffLine | { kind: 'gap'; lines: number }> {
  const keep = diff.map(() => false);
  diff.forEach((d, i) => {
    if (d.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { kind: 'gap'; lines: number }> = [];
  let skipped = 0;
  diff.forEach((d, i) => {
    if (!keep[i]) {
      skipped++;
      return;
    }
    if (skipped > 0) out.push({ kind: 'gap', lines: skipped });
    skipped = 0;
    out.push(d);
  });
  if (skipped > 0 && out.length > 0) out.push({ kind: 'gap', lines: skipped });
  return out;
}

/** A behavior's text without its `@from` line: what is compared when the shelf has a newer one. */
function unmarked(source: string): string {
  let inHeader = true;
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (inHeader && t !== '' && !t.startsWith('//')) inHeader = false;
      return !(inHeader && /^\/\/\s*@from\b/.test(t));
    })
    .join('\n');
}

/** What "update" would do to one copy. */
export interface UpdateOffer {
  name: string;
  from: number;
  to: number;
  /** The copy was edited on this robot: updating loses those edits. Undefined when that cannot be told. */
  edited?: boolean;
  /** The copy against the shelf's text (their `@from` lines left out). */
  diff: DiffLine[];
  added: number;
  removed: number;
  /** The text the copy would become. */
  next: string;
}

/** The update the shelf offers for a robot's copy, or undefined when it is not a copy or the shelf has nothing newer. */
export function updateOffer(copy: string, shelf: readonly ShelfEntry[]): UpdateOffer | undefined {
  const from = parseBehaviorHeader(copy).header?.from;
  const entry = from ? shelf.find((e) => e.id === from.id) : undefined;
  if (!from || !entry || entry.header.version <= from.version) return undefined;
  const diff = lineDiff(unmarked(copy), unmarked(entry.source));
  const edited = behaviorEdited(copy);
  return { name: entry.header.name, from: from.version, to: entry.header.version, ...(edited !== undefined ? { edited } : {}), diff, added: diff.filter((d) => d.kind === 'add').length, removed: diff.filter((d) => d.kind === 'del').length, next: behaviorCopy(entry.id, entry.source) };
}

/**
 * Replaces a copy with the shelf's newer text, as one blueprint (one undo step). Its params, its key, whether it is on
 * at start, and the groups its slots filled all stay. The same blueprint when there is nothing to update.
 */
export function applyUpdate(bp: Blueprint, registry: PartRegistry, shelf: readonly ShelfEntry[], core: string | undefined, scriptId: string): { bp: Blueprint; lines: NoteLine[] } {
  const controls = controlsOf(bp, registry, core);
  const script = controls.scripts.find((s) => s.id === scriptId);
  const offer = typeof script?.source === 'string' ? updateOffer(script.source, shelf) : undefined;
  if (!offer) return { bp, lines: [] };
  const next = updateScript({ bindings: controls.bindings, scripts: controls.scripts }, scriptId, { source: offer.next });
  return {
    bp: withControls(bp, registry, core, { scripts: next.scripts }),
    lines: [{ text: `${offer.name} is now version ${offer.to} (it was ${offer.from}).${offer.edited ? ' The edits made to this copy are gone: Undo brings them back.' : ''} Its settings and groups are as they were.` }],
  };
}

/** What removing a script would also offer to clear: the groups its slots filled that no other script here names. */
export function clearableGroups(bp: Blueprint, registry: PartRegistry, core: string | undefined, scriptId: string): CardSlot[] {
  const card = behaviorCards(bp, registry, [], core).find((c) => c.id === scriptId);
  if (!card) return [];
  const own = controlsOf(bp, registry, core).scripts.find((s) => s.id === scriptId);
  const others = scriptRuns(bp).filter((r) => r.recipes.length === 0 && r.script !== own && typeof r.script.source === 'string');
  return card.slots.filter((s) => s.filled.length > 0 && !others.some((r) => readScript(r.script.source as string).strings.has(s.slot.group) || readScript(r.script.source as string).strings.has(s.tag)));
}

/**
 * Removes a script and the keys that switch it, as one blueprint. With `clear`, the groups its slots filled go too
 * (those no other script names), and parts a slot owned get their own keys back.
 */
export function removeBehavior(bp: Blueprint, registry: PartRegistry, core: string | undefined, scriptId: string, clear: boolean): { bp: Blueprint; lines: NoteLine[] } {
  const controls = controlsOf(bp, registry, core);
  const script = controls.scripts.find((s) => s.id === scriptId);
  if (!script) return { bp, lines: [] };
  const header = typeof script.source === 'string' ? parseBehaviorHeader(script.source).header : undefined;
  const groups = clear ? clearableGroups(bp, registry, core, scriptId) : [];
  const next = removeScript({ bindings: controls.bindings, scripts: controls.scripts }, scriptId);
  let out = withControls(bp, registry, core, { bindings: next.bindings, scripts: next.scripts });
  const back: string[] = [];
  for (const g of groups) {
    out = removeTagFromParts(out, g.filled, g.tag);
    if (!g.slot.owns) continue;
    const off = g.filled.filter((id) => bp.parts.find((p) => p.id === id)?.auto === false);
    if (off.length > 0) out = setPartsAuto(out, off, true);
    for (const id of off) if (!back.includes(id)) back.push(id);
  }
  const name = header?.name ?? `${scriptId}.js`;
  const kinds = countParts(registry, back.map((id) => bp.parts.find((p) => p.id === id)?.part ?? ''));
  const lines: NoteLine[] = [{ text: `Removed ${name}.${groups.length > 0 ? ` Cleared ${groups.length === 1 ? 'its group' : 'its groups'} ${groups.map((g) => g.tag).join(', ')}.` : ''}${back.length > 0 ? ` ${cap(kinds)} ${back.length === 1 ? 'has its own key' : 'have their own keys'} back.` : ''}` }];
  if (script.file !== undefined) lines.push({ text: `Its file ${script.file} stays in blueprints/ until you delete it.` });
  return { bp: out, lines };
}

/** The blueprint with one script's key set: the key that switches it on and off (its `script` binding). Undefined takes the key away. */
export function setScriptKey(bp: Blueprint, registry: PartRegistry, core: string | undefined, scriptId: string, key: string | undefined): Blueprint {
  const controls = controlsOf(bp, registry, core);
  const had = controls.bindings.find((b) => b.mode === 'script' && b.script === scriptId);
  if ((had?.key ?? undefined) === key) return bp;
  const rest = controls.bindings.filter((b) => !(b.mode === 'script' && b.script === scriptId));
  const bindings = key === undefined ? rest : had ? controls.bindings.map((b) => (b === had ? { ...b, key } : b)) : [...controls.bindings, { key, mode: 'script' as const, script: scriptId }];
  return withControls(bp, registry, core, { bindings });
}
