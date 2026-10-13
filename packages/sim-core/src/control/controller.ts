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
  /** Script layer (`04`): values scripts set this tick, by part and channel. Last write wins. */
  private readonly scriptLayer = new Map<string, Map<string, number>>();
  /** The parts each target a script wrote to reaches, in part order: found once, then kept as parts leave. */
  private readonly reached = new Map<string, readonly ControlledPart[]>();
  /**
   * The trace (M16, `trace`), only while something asked for it (`setTrace`): every script write of this tick as it
   * was made, and which script wrote each value now in the script layer. Never read by `values`, never hashed.
   */
  private tracing: { writes: TraceWrite[]; by: Map<string, Map<string, string>> } | undefined;

  constructor(bindings: readonly Binding[], parts: readonly ControlledPart[]) {
    const keys: string[] = [];
    this.parts = parts;
    for (const p of parts) if (p.inputs.length > 0) this.channels.set(p.id, p.inputs.map((c) => ({ ...c })));
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
    let reach = this.reached.get(target);
    if (!reach) {
      // A script that makes up a new target every tick must not fill this for good.
      if (this.reached.size >= REACHED_KEPT) this.reached.clear();
      reach = this.parts.filter((p) => matchesTarget(p, target));
      this.reached.set(target, reach);
    }
    let parts = 0;
    for (const p of reach) {
      if (!p.inputs.some((c) => c.name === channel)) continue;
      let chans = this.scriptLayer.get(p.id);
      if (!chans) this.scriptLayer.set(p.id, (chans = new Map()));
      chans.set(channel, value);
      parts++;
      if (this.tracing) {
        let who = this.tracing.by.get(p.id);
        if (!who) this.tracing.by.set(p.id, (who = new Map()));
        who.set(channel, by);
      }
    }
    if (this.tracing) this.tracing.writes.push({ script: by, target, channel, value, parts });
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
        const scripted = this.scriptLayer.get(id)?.get(c.name);
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
    const sums = new Map<string, Map<string, number>>();
    for (const w of this.writers) {
      const active =
        w.mode === 'hold' ? this.held.has(w.key) || this.pressedNow.has(w.key) : w.mode === 'toggle' ? this.toggles.has(w.index) : !latch && this.pulses.has(w.index);
      if (!active) continue;
      for (const id of w.partIds) {
        let chans = sums.get(id);
        if (!chans) sums.set(id, (chans = new Map()));
        chans.set(w.channel, (chans.get(w.channel) ?? 0) + w.value);
      }
    }
    const out = new Map<string, Map<string, number>>();
    for (const [id, chans] of this.channels) {
      const vals = new Map<string, number>();
      for (const c of chans) {
        // Arbitration (`04`): an active manual writer wins, then a script, then the default.
        const sum = sums.get(id)?.get(c.name);
        const scripted = this.scriptLayer.get(id)?.get(c.name);
        const v = sum ?? scripted;
        vals.set(c.name, v === undefined ? c.default : Math.min(c.max, Math.max(c.min, v)));
      }
      out.set(id, vals);
    }
    return out;
  }

  /**
   * Keeps only these parts (the rest broke off or were destroyed). Keys, toggles, and bindings stay as they are;
   * a binding whose parts are all gone writes nothing.
   */
  restrict(partIds: ReadonlySet<string>): void {
    this.parts = this.parts.filter((p) => partIds.has(p.id));
    for (const [target, reach] of this.reached) if (reach.some((p) => !partIds.has(p.id))) this.reached.set(target, reach.filter((p) => partIds.has(p.id)));
    for (const id of [...this.channels.keys()]) if (!partIds.has(id)) this.channels.delete(id);
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
    for (const [id, chans] of old.scriptLayer) if (this.channels.has(id)) this.scriptLayer.set(id, new Map(chans));
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
    this.scriptLayer.clear();
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
