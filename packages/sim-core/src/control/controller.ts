import type { Binding } from '../blueprint/types';
import { matchesTarget } from './target';
import type { ControlledPart, ControlState } from './types';

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

  /** A script's `set(target, channel, value)` for this tick: every controlled part the target reaches with that channel. */
  scriptWrite(target: string, channel: string, value: number): void {
    for (const p of this.parts) {
      if (!matchesTarget(p, target) || !p.inputs.some((c) => c.name === channel)) continue;
      let chans = this.scriptLayer.get(p.id);
      if (!chans) this.scriptLayer.set(p.id, (chans = new Map()));
      chans.set(channel, value);
    }
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
    for (const id of [...this.channels.keys()]) if (!partIds.has(id)) this.channels.delete(id);
    for (const w of this.writers) w.partIds = w.partIds.filter((id) => partIds.has(id));
    // A key whose parts all broke off leaves the keys bar.
    this.keys = this.keys.filter((k) => this.scriptKeys.has(k) || this.writers.some((w) => w.key === k && w.partIds.length > 0));
  }

  /**
   * Takes over another controller's held keys and toggles (M12): a robot that grew parts (a fabricator bay finishing
   * an item) gets a new controller for its new bindings, and keys held or toggled on stay so. A toggle carries to the
   * same binding (key, mode, target, channel, value), wherever it now is in the list.
   */
  carryFrom(old: Controller): void {
    for (const k of old.held) this.held.add(k);
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
