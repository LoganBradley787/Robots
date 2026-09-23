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

  append(tick: number, frames: readonly InputFrame[]): void {
    if (frames.length === 0) return;
    this.entries.push({ tick, frames: frames.map(cloneFrame) });
  }

  framesAt(tick: number): InputFrame[] {
    const entry = this.entries.find((e) => e.tick === tick);
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
