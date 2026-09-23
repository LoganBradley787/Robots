import type { RobotInput } from '../control/types';

/** World settings changed on a tick (sandbox switches). Part of the simulation, so they are logged. */
export interface WorldChange {
  unlimitedEnergy?: boolean;
}

export interface LoggedTick {
  tick: number;
  inputs: RobotInput[];
  world?: WorldChange;
}

function cloneInput(i: RobotInput): RobotInput {
  return { robot: i.robot, pressed: [...i.pressed], released: [...i.released] };
}

/**
 * Sparse per-tick log of every key edge the world consumed, addressed by robot, and every world setting change.
 * Replay = world file + spawns + this. Only edges are stored: held keys and toggles live in each robot's controller.
 */
export class InputLog {
  private readonly entries: LoggedTick[] = [];
  private readonly byTick = new Map<number, LoggedTick>();

  /** Ticks must strictly increase: the log is written once per tick, in order. */
  append(tick: number, inputs: readonly RobotInput[], world?: WorldChange): void {
    const kept = inputs.filter((i) => i.pressed.length > 0 || i.released.length > 0);
    if (kept.length === 0 && world === undefined) return;
    const last = this.entries[this.entries.length - 1];
    if (last && tick <= last.tick) throw new Error(`input log tick ${tick} is not after ${last.tick}`);
    const entry: LoggedTick = { tick, inputs: kept.map(cloneInput) };
    if (world !== undefined) entry.world = { ...world };
    this.entries.push(entry);
    this.byTick.set(tick, entry);
  }

  inputsAt(tick: number): RobotInput[] {
    const entry = this.byTick.get(tick);
    return entry ? entry.inputs.map(cloneInput) : [];
  }

  worldAt(tick: number): WorldChange | undefined {
    const w = this.byTick.get(tick)?.world;
    return w ? { ...w } : undefined;
  }

  get length(): number {
    return this.entries.length;
  }

  toJSON(): LoggedTick[] {
    return this.entries.map((e) => ({ tick: e.tick, inputs: e.inputs.map(cloneInput), ...(e.world ? { world: { ...e.world } } : {}) }));
  }

  static fromJSON(entries: LoggedTick[]): InputLog {
    const log = new InputLog();
    for (const e of entries) log.append(e.tick, e.inputs, e.world);
    return log;
  }
}
