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
  readonly keys: readonly string[];
  private readonly writers: Writer[] = [];
  private readonly channels = new Map<string, Channel[]>();
  private readonly held = new Set<string>();
  /** Keys pressed this tick: a tap (press and release in one tick) still holds for that tick. */
  private readonly pressedNow = new Set<string>();
  private readonly toggles = new Set<number>();
  private readonly pulses = new Set<number>();

  constructor(bindings: readonly Binding[], parts: readonly ControlledPart[]) {
    const keys: string[] = [];
    for (const p of parts) if (p.inputs.length > 0) this.channels.set(p.id, p.inputs.map((c) => ({ ...c })));
    bindings.forEach((b, index) => {
      if (!keys.includes(b.key)) keys.push(b.key);
      if (b.mode === 'script' || b.target === undefined || b.channel === undefined || b.value === undefined) return;
      const channel = b.channel;
      const target = b.target;
      const partIds = parts.filter((p) => matchesTarget(p, target) && p.inputs.some((c) => c.name === channel)).map((p) => p.id);
      this.writers.push({ index, key: b.key, mode: b.mode, channel, value: b.value, partIds });
    });
    this.keys = keys;
  }

  /** Applies this tick's key edges. Presses are applied before releases. */
  apply(pressed: readonly string[], released: readonly string[]): void {
    for (const key of pressed) {
      if (this.held.has(key)) continue;
      this.held.add(key);
      this.pressedNow.add(key);
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
    for (const key of released) this.held.delete(key);
  }

  /** Final value of every input channel of every controlled part, for this tick. */
  values(): Map<string, Map<string, number>> {
    const sums = new Map<string, Map<string, number>>();
    for (const w of this.writers) {
      const active =
        w.mode === 'hold' ? this.held.has(w.key) || this.pressedNow.has(w.key) : w.mode === 'toggle' ? this.toggles.has(w.index) : this.pulses.has(w.index);
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
        const sum = sums.get(id)?.get(c.name);
        vals.set(c.name, sum === undefined ? c.default : Math.min(c.max, Math.max(c.min, sum)));
      }
      out.set(id, vals);
    }
    return out;
  }

  /** Ends the tick: pulses and taps last exactly one tick. */
  endTick(): void {
    this.pressedNow.clear();
    this.pulses.clear();
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /** Whether any toggle binding on this key is on. */
  isToggledOn(key: string): boolean {
    return this.writers.some((w) => w.key === key && w.mode === 'toggle' && this.toggles.has(w.index));
  }

  state(): ControlState {
    return { held: [...this.held].sort(), toggles: [...this.toggles].sort((a, b) => a - b) };
  }
}
