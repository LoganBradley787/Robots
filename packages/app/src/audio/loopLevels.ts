/** What drives a looping voice (M15): one of the part's input channels, or an output over a number in its config. */
export interface LoopDrive {
  input?: string;
  output?: string;
  /** The behaviorConfig value the output is divided by (a wheel's `maxSpeed`). */
  over?: string;
}

/** How a part's level is read, per voice name. A voice not listed here is driven some other way (the laser: its beam). */
export const LOOP_DRIVES: Readonly<Record<string, LoopDrive>> = {
  propeller: { input: 'throttle' },
  thruster: { input: 'throttle' },
  wheel: { output: 'angularVelocity', over: 'maxSpeed' },
};

/** The part of a part this needs, so tests pass plain objects. */
export interface DrivenPart {
  id: string;
  def: { behaviorConfig?: Record<string, number> };
}

/** A part's level, 0 (off) to 1 (flat out), read through `input` and `output` (the world's channel and output reads). */
export function partLevel(drive: LoopDrive, part: DrivenPart, input: (channel: string) => number | undefined, output: (name: string) => number | undefined): number {
  let v = 0;
  if (drive.input !== undefined) v = input(drive.input) ?? 0;
  else if (drive.output !== undefined) {
    const over = drive.over === undefined ? 1 : (part.def.behaviorConfig?.[drive.over] ?? 1);
    v = (output(drive.output) ?? 0) / (over > 0 ? over : 1);
  }
  v = Math.abs(v);
  return Number.isFinite(v) ? Math.min(1, v) : 0;
}

/** How loud a group of parts with summed level `sum` is: four are twice one, hundreds do not clip. */
export function loopGain(sum: number): number {
  return sum > 0 ? Math.min(1, 0.3 * Math.sqrt(sum)) : 0;
}

/** One robot's parts sharing a voice, summed. */
export interface LoopGroup {
  /** `robot:voice`. */
  key: string;
  robot: number;
  voice: string;
  /** Sum of the parts' levels. */
  sum: number;
  /** Parts with a level above 0. */
  on: number;
  x: number;
  y: number;
}

/** The mean level of the parts that are on, 0 to 1: what the voice's pitch and tone follow. */
export function meanLevel(g: Pick<LoopGroup, 'sum' | 'on'>): number {
  return g.on > 0 ? Math.min(1, g.sum / g.on) : 0;
}

export const MAX_LOOPS = 12;
/** Quieter than this at the ear, a loop is not worth a voice. */
export const LOOP_FLOOR = 0.003;

/** The groups that get a voice: the `max` loudest at the ear (`earGain` is the ear's gain for a point). */
export function pickLoops(groups: readonly LoopGroup[], earGain: (x: number, y: number) => number, max = MAX_LOOPS): LoopGroup[] {
  return groups
    .map((g) => ({ g, loud: loopGain(g.sum) * earGain(g.x, g.y) }))
    .filter((e) => e.loud >= LOOP_FLOOR)
    .sort((a, b) => b.loud - a.loud || (a.g.key < b.g.key ? -1 : 1))
    .slice(0, max)
    .map((e) => e.g);
}
