import type { RobotInput } from '../control/types';

export interface LoggedTick {
  tick: number;
  inputs: RobotInput[];
}

function cloneInput(i: RobotInput): RobotInput {
  return { robot: i.robot, pressed: [...i.pressed], released: [...i.released] };
}

/**
 * Sparse per-tick log of every key edge the world consumed, addressed by robot. Replay = world file + spawns + this.
 * Only edges are stored: held keys and toggles live in each robot's controller.
 */
export class InputLog {
  private readonly entries: LoggedTick[] = [];
  private readonly byTick = new Map<number, LoggedTick>();

  /** Ticks must strictly increase: the log is written once per tick, in order. */
  append(tick: number, inputs: readonly RobotInput[]): void {
    const kept = inputs.filter((i) => i.pressed.length > 0 || i.released.length > 0);
    if (kept.length === 0) return;
    const last = this.entries[this.entries.length - 1];
    if (last && tick <= last.tick) throw new Error(`input log tick ${tick} is not after ${last.tick}`);
    const entry = { tick, inputs: kept.map(cloneInput) };
    this.entries.push(entry);
    this.byTick.set(tick, entry);
  }

  inputsAt(tick: number): RobotInput[] {
    const entry = this.byTick.get(tick);
    return entry ? entry.inputs.map(cloneInput) : [];
  }

  get length(): number {
    return this.entries.length;
  }

  toJSON(): LoggedTick[] {
    return this.entries.map((e) => ({ tick: e.tick, inputs: e.inputs.map(cloneInput) }));
  }

  static fromJSON(entries: LoggedTick[]): InputLog {
    const log = new InputLog();
    for (const e of entries) log.append(e.tick, e.inputs);
    return log;
  }
}
