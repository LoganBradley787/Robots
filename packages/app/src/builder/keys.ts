import { matchesTarget, partAutoBindings, scopedView, type Binding, type BindingMode, type Blueprint, type ChannelDef, type PartRegistry, type PlacedPart } from '@robots/sim-core';
import { worldKeyLabel } from '../app/keys';
import { channelsForTarget } from './bindings';
import { controlsOf, withControls, type ControlsView } from './coreControls';

/**
 * The keys UI's logic (M16 step 6), with no screen in it: binding a key from a part's input row, who a binding
 * drives, making an auto key yours, what every key on the drawn keyboard does and who owns it, and a binding said as
 * a sentence. Nothing here changes the binding format or how bindings are arbitrated: it only writes the same
 * `Binding` records the file has always had. All of it reads names and inputs, never a part type.
 */

/** The three ways a key drives an input. A key can also switch a script (`script`), which is its own kind of row. */
export type InputMode = 'hold' | 'toggle' | 'pulse';

export const INPUT_MODES: readonly InputMode[] = ['hold', 'toggle', 'pulse'];

/** The words the builder shows. The file keeps `hold`, `toggle`, `pulse`. */
export const MODE_WORDS: Readonly<Record<BindingMode, string>> = { hold: 'while held', toggle: 'on and off', pulse: 'tap once', script: 'switches a script' };

export const MODE_HELP: Readonly<Record<InputMode, string>> = {
  hold: 'It drives the input for as long as the key is down.',
  toggle: 'One press turns it on, the next turns it off.',
  pulse: 'Each press drives the input for one moment: a shot, a release.',
};

/** How a stored key shows on a cap: letters upper case, arrows as arrows, the rest as its name. */
export function keyLabel(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const arrow: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return arrow[key] ?? key.replace(/^Numpad/, 'Num ');
}

/** The value a new binding starts at: the input's full value (its top, or its bottom when it only goes down). */
export function fullValue(ch: { min: number; max: number }): number {
  return ch.max !== 0 ? ch.max : ch.min;
}

/** An input value as the builder shows it: the sign only where the input can go both ways. */
export function valueWords(value: number, ch: { min: number } | undefined): string {
  const n = Math.round(value * 100);
  return `${ch !== undefined && ch.min < 0 && n > 0 ? '+' : ''}${n}%`;
}

/** "-1 to 1, rests at 0.5": an input's range in plain words. */
export function rangeWords(ch: ChannelDef): string {
  const n = (v: number): string => String(Number(v.toFixed(2)));
  return `${n(ch.min)} to ${n(ch.max)}${ch.default !== 0 ? `, rests at ${n(ch.default)}` : ''}`;
}

const nameOf = (registry: PartRegistry, type: string): string => (registry.has(type) ? registry.get(type).name : type);

/** How a part's type reads as a target: "all Wheels". */
export function kindWords(registry: PartRegistry, type: string): string {
  return `all ${nameOf(registry, type)}s`;
}

/** Who one binding can drive, seen from a part: itself, every part of its kind, or one of its groups. */
export interface Scope {
  kind: 'part' | 'kind' | 'group';
  /** What the binding stores as its target. */
  target: string;
  label: string;
}

/** The scopes a binding made from this part can have, narrowest first. Under `scope` (a placed copy's core) its groups are that copy's own. */
export function partScopes(bp: Blueprint, registry: PartRegistry, partId: string, scope?: string): Scope[] {
  const p = bp.parts.find((x) => x.id === partId);
  if (!p) return [];
  const out: Scope[] = [
    { kind: 'part', target: p.id, label: 'this part' },
    { kind: 'kind', target: p.part, label: kindWords(registry, p.part) },
  ];
  for (const t of scopedView(p, scope).tags) if (t !== p.id && t !== p.part && !out.some((o) => o.target === t)) out.push({ kind: 'group', target: t, label: t });
  return out;
}

/** The parts a target reaches that have this input: what a key bound to it would drive. */
export function reachOf(bp: Blueprint, registry: PartRegistry, target: string, channel: string | undefined, scope?: string): string[] {
  return bp.parts
    .filter((p) => matchesTarget(scopedView(p, scope), target) && (channel === undefined || (registry.has(p.part) && registry.get(p.part).inputs.some((c) => c.name === channel))))
    .map((p) => p.id);
}

/** A key of yours that drives one input of one part: the binding, and where it sits in the core's list. */
export interface InputBinding {
  index: number;
  binding: Binding;
  /** Which of the part's scopes its target is. */
  scope: Scope;
}

/** The bindings of these controls that drive `channel` on this part, in file order. */
export function inputBindings(bp: Blueprint, registry: PartRegistry, controls: Pick<ControlsView, 'bindings' | 'scope'>, partId: string, channel: string): InputBinding[] {
  const scopes = partScopes(bp, registry, partId, controls.scope);
  const out: InputBinding[] = [];
  controls.bindings.forEach((binding, index) => {
    if (binding.mode === 'script' || binding.channel !== channel) return;
    const scope = scopes.find((s) => s.target === binding.target);
    if (scope) out.push({ index, binding, scope });
  });
  return out;
}

/** The auto keys one input of a part has right now: none when the part, or the whole robot, has them off. */
export function inputAutoKeys(bp: Blueprint, registry: PartRegistry, controls: Pick<ControlsView, 'autoOn'>, partId: string, channel: string): Binding[] {
  const p = bp.parts.find((x) => x.id === partId);
  if (!p || p.auto === false || !controls.autoOn) return [];
  return partAutoBindings(p, registry).filter((b) => b.channel === channel);
}

/** Why a key cannot be bound (a world key), or undefined when it can. `code` is the physical key. */
export function refusal(code: string): string | undefined {
  const reserved = worldKeyLabel(code);
  return reserved === undefined ? undefined : `${reserved}, so it cannot drive the robot. Letters and digits are all yours.`;
}

/**
 * A new binding from a part's input row: `key` drives `channel` on `target` while held, at the input's full value.
 * Returns the list with it added, or the same list when the target has no such input.
 */
export function bindFromPart(bp: Blueprint, registry: PartRegistry, controls: Pick<ControlsView, 'bindings' | 'scope'>, key: string, target: string, channel: string): readonly Binding[] {
  const ch = channelsForTarget(bp, registry, target, controls.scope).find((c) => c.name === channel);
  if (!ch) return controls.bindings;
  return [...controls.bindings, { key, mode: 'hold', target, channel, value: fullValue(ch) }];
}

/** The same list with one binding changed. */
export function patchBinding(bindings: readonly Binding[], index: number, patch: Partial<Binding>): Binding[] {
  return bindings.map((b, i) => (i === index ? { ...b, ...patch } : b));
}

/**
 * Points a binding at another target. It keeps its input when the new target has it (else the target's first), and
 * its value, held inside the input's range.
 */
export function retarget(bp: Blueprint, registry: PartRegistry, controls: Pick<ControlsView, 'bindings' | 'scope'>, index: number, target: string): Binding[] {
  const b = controls.bindings[index];
  if (!b || b.target === target) return [...controls.bindings];
  const channels = channelsForTarget(bp, registry, target, controls.scope);
  const keep = channels.find((c) => c.name === b.channel) ?? channels[0];
  return patchBinding(controls.bindings, index, { target, channel: keep?.name ?? b.channel ?? '', value: keep ? Math.min(keep.max, Math.max(keep.min, b.value ?? fullValue(keep))) : (b.value ?? 1) });
}

/**
 * Makes auto keys yours (M16): auto goes off for these parts and the keys the game gave them are written as plain
 * bindings on the core's list, so the robot drives exactly as before and every one of them can now be edited. One
 * blueprint out: one undo step. Parts with auto already off, or with no auto keys, are left alone.
 *
 * With `byKind`, parts whose auto keys are the same for every part of their kind (all the wheels) get one binding
 * per key for the kind, not one per part. It is only used when no other part of that kind would be caught by it.
 */
export function claimAuto(bp: Blueprint, registry: PartRegistry, core: string | undefined, ids: readonly string[], opts: { byKind?: boolean } = {}): Blueprint {
  const controls = controlsOf(bp, registry, core);
  if (!controls.autoOn) return bp;
  const mine = bp.parts.filter((p) => ids.includes(p.id) && p.auto !== false && partAutoBindings(p, registry).length > 0);
  if (mine.length === 0) return bp;
  const sig = (p: PlacedPart): string => JSON.stringify(partAutoBindings(p, registry).map((b) => [b.key, b.channel, b.value]));
  const added: Binding[] = [];
  const done = new Set<string>();
  if (opts.byKind) {
    for (const type of new Set(mine.map((p) => p.part))) {
      // Everything the kind's name would reach under these controls, and whether they all are being claimed alike.
      const reached = bp.parts.filter((p) => matchesTarget(scopedView(p, controls.scope), type));
      const first = reached[0];
      if (!first || reached.length < 2 || !reached.every((p) => mine.includes(p) && sig(p) === sig(first))) continue;
      for (const b of partAutoBindings(first, registry)) added.push({ ...b, target: type });
      for (const p of reached) done.add(p.id);
    }
  }
  for (const p of mine) if (!done.has(p.id)) added.push(...partAutoBindings(p, registry));
  const claimed = new Set(mine.map((p) => p.id));
  const parts = bp.parts.map((p) => (claimed.has(p.id) ? { ...p, auto: false as const } : p));
  return withControls({ ...bp, parts }, registry, core, { bindings: [...controls.bindings, ...added] });
}

/** A binding a script switch or an input key, said in one sentence: "F, tap once: all Launchers, fire 100%". */
export function bindingSentence(bp: Blueprint, registry: PartRegistry, b: Binding, scope?: string): string {
  const key = keyLabel(b.key);
  if (b.mode === 'script') return `${key}: switches ${b.script !== undefined && b.script !== '' ? `${b.script}.js` : 'no script yet'} on and off`;
  return `${key}, ${MODE_WORDS[b.mode]}: ${bindingWhat(bp, registry, b, scope)}`;
}

/** The second half of that sentence: who and what. */
export function bindingWhat(bp: Blueprint, registry: PartRegistry, b: Binding, scope?: string): string {
  const target = b.target ?? '';
  const ch = channelsForTarget(bp, registry, target, scope).find((c) => c.name === b.channel);
  return `${targetWords(bp, registry, target, scope)}, ${b.channel ?? ''} ${valueWords(b.value ?? 0, ch)}`;
}

/** A target in plain words: "all Wheels", "group left", "the Wheel at 3, 2", or the bare name with a note when nothing answers to it. */
export function targetWords(bp: Blueprint, registry: PartRegistry, target: string, scope?: string): string {
  const one = bp.parts.find((p) => p.id === target);
  if (one) return `the ${nameOf(registry, one.part)} at ${one.x}, ${one.y}`;
  if (bp.parts.some((p) => scopedView(p, scope).part === target)) return kindWords(registry, target);
  if (bp.parts.some((p) => matchesTarget(scopedView(p, scope), target))) return `group ${target}`;
  return `${target === '' ? 'nothing' : target} (not on this robot)`;
}

/** One auto key's work, folded by kind and direction: "4 Wheels forward". */
export interface AutoUse {
  key: string;
  channel: string;
  value: number;
  /** The parts it drives. */
  ids: string[];
  text: string;
}

/**
 * The auto keys these controls have, folded so 32 wheels are one line per key. The main core's are every part's; a
 * placed copy's core gets its own piece's when it wakes, which here means the parts that carry its scope.
 */
export function autoUses(bp: Blueprint, registry: PartRegistry, controls: Pick<ControlsView, 'autoOn' | 'core' | 'scope'>): AutoUse[] {
  if (!controls.autoOn) return [];
  const scope = controls.scope;
  if (controls.core !== undefined && scope === undefined) return [];
  const out = new Map<string, AutoUse>();
  for (const p of bp.parts) {
    if (p.auto === false || (scope !== undefined && !p.tags.includes(scope))) continue;
    const ac = registry.has(p.part) ? registry.get(p.part).autoControl : undefined;
    for (const b of partAutoBindings(p, registry)) {
      const [up, down] = ac?.labels ?? ['forward', 'reverse'];
      const dir = ac?.kind === 'axis' ? ((b.value ?? 0) > 0 ? up : down) : '';
      const k = `${b.key}\0${p.part}\0${b.channel ?? ''}\0${dir}`;
      const use = out.get(k) ?? { key: b.key, channel: b.channel ?? '', value: b.value ?? 0, ids: [], text: dir };
      use.ids.push(p.id);
      out.set(k, use);
    }
  }
  return [...out.entries()].map(([k, use]) => {
    const type = k.split('\0')[1] ?? '';
    const n = use.ids.length;
    return { ...use, text: `${n} ${nameOf(registry, type)}${n === 1 ? '' : 's'}${use.text !== '' ? ` ${use.text}` : ''}` };
  });
}

/** One key of the drawn keyboard. `code` is the physical key; `key` is what a binding stores for it (`keyName`). */
export interface BoardKey {
  code: string;
  key: string;
  label: string;
  /** Width in key units (1 is a letter). */
  w?: number;
}

const letters = (row: string): BoardKey[] => [...row].map((c) => ({ code: `Key${c}`, key: c.toLowerCase(), label: c }));

/**
 * The keyboard the Keys tab draws, laid out like a real one: digits, letters, Space and the arrows are the robot's;
 * the keys the world keeps are drawn where they sit, so it is plain why they cannot be bound. Each row starts a
 * little further right than the one above (`indent`, in key units).
 */
export const KEYBOARD: ReadonlyArray<{ indent: number; keys: BoardKey[] }> = [
  {
    indent: 0,
    keys: [{ code: 'Escape', key: 'Escape', label: 'esc', w: 1.4 }, { code: 'Backquote', key: 'Backquote', label: '`' }, ...[...'1234567890'].map((d) => ({ code: `Digit${d}`, key: d, label: d }))],
  },
  { indent: 0.5, keys: [...letters('QWERTYUIOP'), { code: 'BracketLeft', key: 'BracketLeft', label: '[' }, { code: 'BracketRight', key: 'BracketRight', label: ']' }] },
  { indent: 0.9, keys: [...letters('ASDFGHJKL'), { code: 'Backslash', key: 'Backslash', label: '\\' }] },
  { indent: 1.4, keys: [...letters('ZXCVBNM'), { code: 'Comma', key: 'Comma', label: ',' }, { code: 'Period', key: 'Period', label: '.' }] },
  {
    indent: 0,
    keys: [
      { code: 'Tab', key: 'Tab', label: 'tab', w: 1.6 },
      { code: 'Space', key: 'Space', label: 'space', w: 5 },
      { code: 'ArrowLeft', key: 'ArrowLeft', label: '←' },
      { code: 'ArrowUp', key: 'ArrowUp', label: '↑' },
      { code: 'ArrowDown', key: 'ArrowDown', label: '↓' },
      { code: 'ArrowRight', key: 'ArrowRight', label: '→' },
    ],
  },
];

/** Everything one key does under one core's controls, and so who owns it. */
export interface KeyOwner {
  key: string;
  /** Your bindings on it that drive an input, by their place in the list. */
  yours: number[];
  /** Your bindings on it that switch a script. */
  scripts: number[];
  auto: AutoUse[];
  /** Why the world keeps this key (it cannot be bound), when it does. */
  world?: string;
  /**
   * It does two unrelated things: more than one input, or a script switch beside anything else. Keys that only the
   * game chose never clash (D driving the wheels and a sideways thruster is how auto keys are meant to work).
   * A clash is shown, never refused: one key doing two things is sometimes the point.
   */
  clash: boolean;
}

/**
 * Who owns every key: each key of the drawn keyboard, plus any other key a binding uses (a blueprint written by hand
 * can bind `Semicolon`), in that order. A key nobody uses has empty lists.
 */
export function keyOwners(bp: Blueprint, registry: PartRegistry, controls: ControlsView): Map<string, KeyOwner> {
  const out = new Map<string, KeyOwner>();
  const at = (key: string): KeyOwner => {
    let o = out.get(key);
    if (!o) {
      o = { key, yours: [], scripts: [], auto: [], clash: false };
      out.set(key, o);
    }
    return o;
  };
  for (const row of KEYBOARD) {
    for (const k of row.keys) {
      const o = at(k.key);
      const world = worldKeyLabel(k.code);
      if (world !== undefined) o.world = world;
    }
  }
  controls.bindings.forEach((b, i) => (b.mode === 'script' ? at(b.key).scripts : at(b.key).yours).push(i));
  for (const use of autoUses(bp, registry, controls)) at(use.key).auto.push(use);
  for (const o of out.values()) {
    if (o.yours.length === 0 && o.scripts.length === 0) continue;
    const inputs = new Set([...o.yours.map((i) => controls.bindings[i]?.channel ?? ''), ...o.auto.map((a) => a.channel)]);
    o.clash = inputs.size > 1 || (o.scripts.length > 0 && inputs.size > 0) || new Set(o.scripts.map((i) => controls.bindings[i]?.script ?? '')).size > 1;
  }
  return out;
}

/** What a key is on the drawn keyboard: `world` cannot be bound; `yours` beats `script` beats `auto`. */
export function ownerKind(o: KeyOwner | undefined): 'world' | 'yours' | 'script' | 'auto' | 'free' {
  if (!o) return 'free';
  if (o.world !== undefined) return 'world';
  if (o.yours.length > 0) return 'yours';
  if (o.scripts.length > 0) return 'script';
  return o.auto.length > 0 ? 'auto' : 'free';
}
