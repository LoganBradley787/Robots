import type { Binding } from '../blueprint/types';
import { matchesTarget } from './target';
import type { ControlledPart, ControlState, ControlTrace, TraceInput, TraceWrite } from './types';

interface Writer {
  index: number;
  key: string;
  mode: 'hold' | 'toggle' | 'pulse';
  channel: string;
  value: number;
  /** Parts with the target and the channel, resolved once. */
  partIds: string[];
  /** What the binding is, to find the same one in a rebuilt controller (M12). */
  sig: string;
}

/** Targets whose parts a controller keeps for script writes (`Controller.scriptWrite`); past this it starts over. */
const REACHED_KEPT = 1000;

interface Channel {
  name: string;
  min: number;
  max: number;
  default: number;
}

/**
 * One input of one part. The script layer (`04`) lives here: `scripted` is the value scripts set this tick, when
 * `written` is the controller's `stamp`. `vals` is the part's map in the controller's kept output and `value` what it
 * holds for this input, so a tick that changes nothing writes nothing.
 */
interface Slot {
  id: string;
  channel: Channel;
  vals: Map<string, number>;
  value: number;
  scripted: number;
  written: number;
}

/**
 * One robot's manual control layer (`04`): key edges in, final channel values out. Holds its own key and toggle
 * state, which only changes through `apply`, so an uncontrolled robot keeps whatever it had (latching).
 * Script bindings are kept for their key but do nothing until scripts exist (M5).
 */
export class Controller {
  /** Every key a binding responds to, in binding order without repeats. */
  /** Keys that still do something (a binding with parts left, or a script key). */
  keys: readonly string[];
  private readonly writers: Writer[] = [];
  private readonly channels = new Map<string, Channel[]>();
  private readonly held = new Set<string>();
  /** Keys pressed this tick: a tap (press and release in one tick) still holds for that tick. */
  private readonly pressedNow = new Set<string>();
  private readonly toggles = new Set<number>();
  private readonly pulses = new Set<number>();
  private readonly releasedNow = new Set<string>();
  private parts: readonly ControlledPart[];
  /** Script ids with a `script` binding, by key. */
  private readonly scriptKeys = new Map<string, string[]>();
  /** Script ids whose key was pressed this tick, in press order. */
  private toggledScripts: string[] = [];
  /** Every input of every controlled part, in `values` order (`Slot`). */
  private slots: Slot[] = [];
  /** The slots of each part. */
  private readonly slotsOf = new Map<string, Slot[]>();
  /** What `values` hands back, updated in place tick to tick: the same maps with the same keys. */
  private readonly output = new Map<string, Map<string, number>>();
  /** This tick's mark on a slot a script wrote (`Slot.written`). */
  private stamp = 1;
  /** The inputs each target and channel a script wrote to reach, in part order: found once, then kept as parts leave. */
  private readonly reached = new Map<string, Map<string, Slot[]>>();
  private reachedCount = 0;
  /**
   * The trace (M16, `trace`), only while something asked for it (`setTrace`): every script write of this tick as it
   * was made, and which script wrote each value now in the script layer. Never read by `values`, never hashed.
   */
  private tracing: { writes: TraceWrite[]; by: Map<string, Map<string, string>> } | undefined;

  constructor(bindings: readonly Binding[], parts: readonly ControlledPart[]) {
    const keys: string[] = [];
    this.parts = parts;
    for (const p of parts) {
      if (p.inputs.length === 0) continue;
      const chans = p.inputs.map((c) => ({ ...c }));
      this.channels.set(p.id, chans);
      const vals = new Map<string, number>();
      this.output.set(p.id, vals);
      const own = chans.map((channel) => {
        // A key in its place in the map, and NaN so the first tick writes it.
        vals.set(channel.name, Number.NaN);
        return { id: p.id, channel, vals, value: Number.NaN, scripted: 0, written: 0 };
      });
      this.slotsOf.set(p.id, own);
      this.slots.push(...own);
    }
    bindings.forEach((b, index) => {
      if (!keys.includes(b.key)) keys.push(b.key);
      if (b.mode === 'script' && b.script !== undefined) this.scriptKeys.set(b.key, [...(this.scriptKeys.get(b.key) ?? []), b.script]);
      if (b.mode === 'script' || b.target === undefined || b.channel === undefined || b.value === undefined) return;
      const channel = b.channel;
      const target = b.target;
      const partIds = parts.filter((p) => matchesTarget(p, target) && p.inputs.some((c) => c.name === channel)).map((p) => p.id);
      this.writers.push({ index, key: b.key, mode: b.mode, channel, value: b.value, partIds, sig: `${b.key}|${b.mode}|${target}|${channel}|${b.value}` });
    });
    this.keys = keys;
  }

  /** Applies this tick's key edges. Presses are applied before releases. */
  apply(pressed: readonly string[], released: readonly string[]): void {
    for (const key of pressed) {
      if (this.held.has(key)) continue;
      this.held.add(key);
      this.pressedNow.add(key);
      this.toggledScripts.push(...(this.scriptKeys.get(key) ?? []));
      for (const w of this.writers) {
        if (w.key !== key) continue;
        if (w.mode === 'toggle') {
          if (this.toggles.has(w.index)) this.toggles.delete(w.index);
          else this.toggles.add(w.index);
        } else if (w.mode === 'pulse') {
          this.pulses.add(w.index);
        }
      }
    }
    for (const key of released) {
      if (this.held.delete(key)) this.releasedNow.add(key);
    }
  }

  /** Script ids toggled by key presses this tick (a script binding flips its script). Clears the list. */
  takeScriptToggles(): string[] {
    const out = this.toggledScripts;
    this.toggledScripts = [];
    return out;
  }

  /** Keys as a script sees them this tick, sorted. */
  keyState(): { down: string[]; pressed: string[]; released: string[] } {
    return { down: [...this.held].sort(), pressed: [...this.pressedNow].sort(), released: [...this.releasedNow].sort() };
  }

  /**
   * A script's `set(target, channel, value)` for this tick: every controlled part the target reaches with that channel.
   * `by` is the script's id, kept only while tracing.
   */
  scriptWrite(target: string, channel: string, value: number, by = ''): void {
    const slots = this.reach(target, channel);
    for (const s of slots) {
      s.scripted = value;
      s.written = this.stamp;
      if (this.tracing) {
        let who = this.tracing.by.get(s.id);
        if (!who) this.tracing.by.set(s.id, (who = new Map()));
        who.set(channel, by);
      }
    }
    if (this.tracing) this.tracing.writes.push({ script: by, target, channel, value, parts: slots.length });
  }

  private reach(target: string, channel: string): readonly Slot[] {
    let channels = this.reached.get(target);
    let slots = channels?.get(channel);
    if (slots) return slots;
    // A script that makes up a new target every tick must not fill this for good.
    if (this.reachedCount >= REACHED_KEPT) {
      this.reached.clear();
      this.reachedCount = 0;
      channels = undefined;
    }
    if (!channels) this.reached.set(target, (channels = new Map()));
    slots = [];
    for (const p of this.parts) {
      if (!matchesTarget(p, target)) continue;
      for (const s of this.slotsOf.get(p.id) ?? []) if (s.channel.name === channel) slots.push(s);
    }
    channels.set(channel, slots);
    this.reachedCount++;
    return slots;
  }

  /** What a script set on an input this tick. */
  private scripted(id: string, name: string): number | undefined {
    const s = this.slotsOf.get(id)?.find((x) => x.channel.name === name);
    return s && s.written === this.stamp ? s.scripted : undefined;
  }

  /** Switches the trace on or off (M16). Off is the default, and costs nothing. */
  setTrace(on: boolean): void {
    if (on === (this.tracing !== undefined)) return;
    this.tracing = on ? { writes: [], by: new Map() } : undefined;
  }

  get traced(): boolean {
    return this.tracing !== undefined;
  }

  /**
   * This tick so far, for a live readout (M16): every `set()` the scripts made, and for each input that a key is
   * bound to or a script wrote, its value and who decided it, by the same rule as `values` (a key that is held or
   * toggled on wins, then a script, then the default). Read it after the scripts ran and before `endTick`. Undefined
   * unless the trace is on. It reads state and changes none.
   */
  trace(): ControlTrace | undefined {
    const t = this.tracing;
    if (!t) return undefined;
    const active = (w: Writer): boolean => (w.mode === 'hold' ? this.held.has(w.key) || this.pressedNow.has(w.key) : w.mode === 'toggle' ? this.toggles.has(w.index) : this.pulses.has(w.index));
    /** Per part and input: every key bound to it, and whether it writes now. */
    const bound = new Map<string, Map<string, { key: string; mode: Writer['mode']; value: number; active: boolean }[]>>();
    for (const w of this.writers) {
      const on = active(w);
      for (const id of w.partIds) {
        let chans = bound.get(id);
        if (!chans) bound.set(id, (chans = new Map()));
        let list = chans.get(w.channel);
        if (!list) chans.set(w.channel, (list = []));
        list.push({ key: w.key, mode: w.mode, value: w.value, active: on });
      }
    }
    const inputs: TraceInput[] = [];
    for (const [id, chans] of this.channels) {
      for (const c of chans) {
        const keys = bound.get(id)?.get(c.name) ?? [];
        const scripted = this.scripted(id, c.name);
        if (keys.length === 0 && scripted === undefined) continue;
        const held = keys.filter((k) => k.active);
        const sum = held.length > 0 ? held.reduce((a, k) => a + k.value, 0) : undefined;
        const v = sum ?? scripted;
        const input: TraceInput = {
          part: id,
          channel: c.name,
          min: c.min,
          max: c.max,
          default: c.default,
          value: v === undefined ? c.default : Math.min(c.max, Math.max(c.min, v)),
          source: sum !== undefined ? 'key' : scripted !== undefined ? 'script' : 'default',
          keys,
        };
        if (scripted !== undefined) input.script = { id: t.by.get(id)?.get(c.name) ?? '', value: scripted };
        inputs.push(input);
      }
    }
    return { writes: t.writes.slice(), inputs };
  }

  /**
   * Final value of every input channel of every controlled part, for this tick. `latch` leaves out this tick's
   * pulses: what a piece that breaks off keeps doing must not repeat a one-tick press forever (`04`, Latching).
   */
  values(latch = false): Map<string, Map<string, number>> {
    let sums: Map<string, Map<string, number>> | undefined;
    for (const w of this.writers) {
      const active =
        w.mode === 'hold' ? this.held.has(w.key) || this.pressedNow.has(w.key) : w.mode === 'toggle' ? this.toggles.has(w.index) : !latch && this.pulses.has(w.index);
      if (!active) continue;
      sums ??= new Map();
      for (const id of w.partIds) {
        let chans = sums.get(id);
        if (!chans) sums.set(id, (chans = new Map()));
        chans.set(w.channel, (chans.get(w.channel) ?? 0) + w.value);
      }
    }
    if (latch) {
      const out = new Map<string, Map<string, number>>();
      for (const s of this.slots) {
        let vals = out.get(s.id);
        if (!vals) out.set(s.id, (vals = new Map()));
        vals.set(s.channel.name, this.final(s, sums));
      }
      return out;
    }
    for (const s of this.slots) {
      const v = this.final(s, sums);
      // Written only when it changed, -0 apart from 0.
      if (v === s.value && (v !== 0 || 1 / v === 1 / s.value)) continue;
      s.value = v;
      s.vals.set(s.channel.name, v);
    }
    return this.output;
  }

  /** Arbitration (`04`): an active manual writer wins, then a script, then the default. */
  private final(s: Slot, sums: Map<string, Map<string, number>> | undefined): number {
    const c = s.channel;
    const sum = sums?.get(s.id)?.get(c.name);
    const v = sum ?? (s.written === this.stamp ? s.scripted : undefined);
    return v === undefined ? c.default : Math.min(c.max, Math.max(c.min, v));
  }

  /**
   * Keeps only these parts (the rest broke off or were destroyed). Keys, toggles, and bindings stay as they are;
   * a binding whose parts are all gone writes nothing.
   */
  restrict(partIds: ReadonlySet<string>): void {
    this.parts = this.parts.filter((p) => partIds.has(p.id));
    for (const channels of this.reached.values()) {
      for (const [channel, slots] of channels) if (slots.some((s) => !partIds.has(s.id))) channels.set(channel, slots.filter((s) => partIds.has(s.id)));
    }
    for (const id of [...this.channels.keys()]) {
      if (partIds.has(id)) continue;
      this.channels.delete(id);
      this.slotsOf.delete(id);
      this.output.delete(id);
    }
    if (this.slots.some((s) => !partIds.has(s.id))) this.slots = this.slots.filter((s) => partIds.has(s.id));
    for (const w of this.writers) w.partIds = w.partIds.filter((id) => partIds.has(id));
    // A key whose parts all broke off leaves the keys bar.
    this.keys = this.keys.filter((k) => this.scriptKeys.has(k) || this.writers.some((w) => w.key === k && w.partIds.length > 0));
  }

  /**
   * Takes over another controller's state (M12): a robot that grew parts (a fabricator bay finishing an item) gets a
   * new controller for its new bindings, and keys held or toggled on stay so, as do this tick's presses, pulses, and
   * script writes. A toggle carries to the
   * same binding (key, mode, target, channel, value), wherever it now is in the list.
   */
  carryFrom(old: Controller): void {
    for (const k of old.held) this.held.add(k);
    // This tick's edges, pulses, and script writes too: the robot grows mid-tick, and what the rest of the tick
    // computes must not fall back to defaults (a hover's throttles went to 0 for the build's tick).
    for (const k of old.pressedNow) this.pressedNow.add(k);
    for (const k of old.releasedNow) this.releasedNow.add(k);
    this.toggledScripts.push(...old.toggledScripts);
    for (const s of old.slots) {
      if (s.written !== old.stamp) continue;
      const own = this.slotsOf.get(s.id)?.find((x) => x.channel.name === s.channel.name);
      if (!own) continue;
      own.scripted = s.scripted;
      own.written = this.stamp;
    }
    if (old.tracing) this.tracing = { writes: old.tracing.writes.slice(), by: new Map([...old.tracing.by].filter(([id]) => this.channels.has(id)).map(([id, who]) => [id, new Map(who)])) };
    for (const i of old.pulses) {
      const sig = old.writers.find((w) => w.index === i)?.sig;
      const w = this.writers.find((x) => x.sig === sig && x.mode === 'pulse');
      if (w) this.pulses.add(w.index);
    }
    const used = new Set<number>();
    for (const i of [...old.toggles].sort((a, b) => a - b)) {
      const sig = old.writers.find((w) => w.index === i)?.sig;
      const w = this.writers.find((x) => x.sig === sig && x.mode === 'toggle' && !used.has(x.index));
      if (!w) continue;
      used.add(w.index);
      this.toggles.add(w.index);
    }
  }

  /** Ends the tick: pulses and taps last exactly one tick. */
  endTick(): void {
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.pulses.clear();
    this.stamp++;
    if (this.tracing) {
      this.tracing.writes = [];
      this.tracing.by.clear();
    }
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /** Keys that have at least one toggle binding. */
  get toggleKeys(): string[] {
    return [...new Set(this.writers.filter((w) => w.mode === 'toggle').map((w) => w.key))];
  }

  /** Whether any toggle binding on this key is on. */
  isToggledOn(key: string): boolean {
    return this.writers.some((w) => w.key === key && w.mode === 'toggle' && this.toggles.has(w.index));
  }

  state(): ControlState {
    return { held: [...this.held].sort(), toggles: [...this.toggles].sort((a, b) => a - b) };
  }
}
