/** One input source's view of one tick. Arrays, not Sets, so it serializes as is. */
export interface InputFrame {
  sourceId: string;
  down: string[];
  pressed: string[];
  released: string[];
}

export interface LoggedTick {
  tick: number;
  frames: InputFrame[];
}

function cloneFrame(f: InputFrame): InputFrame {
  return { sourceId: f.sourceId, down: [...f.down], pressed: [...f.pressed], released: [...f.released] };
}

/** Sparse per-tick log of every input frame the world consumed. Replay = world file + blueprints + this. */
export class InputLog {
  private readonly entries: LoggedTick[] = [];
  private readonly byTick = new Map<number, LoggedTick>();

  /** Ticks must strictly increase: the log is written once per tick, in order. */
  append(tick: number, frames: readonly InputFrame[]): void {
    if (frames.length === 0) return;
    const last = this.entries[this.entries.length - 1];
    if (last && tick <= last.tick) throw new Error(`input log tick ${tick} is not after ${last.tick}`);
    const entry = { tick, frames: frames.map(cloneFrame) };
    this.entries.push(entry);
    this.byTick.set(tick, entry);
  }

  framesAt(tick: number): InputFrame[] {
    const entry = this.byTick.get(tick);
    return entry ? entry.frames.map(cloneFrame) : [];
  }

  get length(): number {
    return this.entries.length;
  }

  toJSON(): LoggedTick[] {
    return this.entries.map((e) => ({ tick: e.tick, frames: e.frames.map(cloneFrame) }));
  }

  static fromJSON(entries: LoggedTick[]): InputLog {
    const log = new InputLog();
    for (const e of entries) log.append(e.tick, e.frames);
    return log;
  }
}
