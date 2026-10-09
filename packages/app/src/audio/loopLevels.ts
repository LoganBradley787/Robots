/**
 * What drives a looping voice (M15): one of the part's input channels, one of its outputs, or how fast its own body
 * spins against the robot's (a wheel: the sim does not fill in its `angularVelocity` output).
 */
export interface LoopDrive {
  input?: string;
  output?: string;
  spin?: true;
  /** The behaviorConfig value an output or a spin is divided by (a wheel's `maxSpeed`). */
  over?: string;
  /** The voice also wants to know how many of the parts touch something (a wheel on the ground). */
  contact?: true;
}

/** How a part's level is read, per voice name. A voice not listed here is driven some other way (the laser: its beam). */
export const LOOP_DRIVES: Readonly<Record<string, LoopDrive>> = {
  propeller: { input: 'throttle' },
  thruster: { input: 'throttle' },
  wheel: { spin: true, over: 'maxSpeed', contact: true },
};

/** The part of a part this needs, so tests pass plain objects. */
export interface DrivenPart {
  id: string;
  def: { behaviorConfig?: Record<string, number> };
}

/**
 * A part's level, 0 (off) to 1 (flat out), read through `input` and `output` (the world's channel and output reads)
 * and `spin` (its body's turning against the robot's, radians a second).
 */
export function partLevel(drive: LoopDrive, part: DrivenPart, input: (channel: string) => number | undefined, output: (name: string) => number | undefined, spin: () => number = () => 0): number {
  let v = 0;
  if (drive.input !== undefined) v = input(drive.input) ?? 0;
  else if (drive.output !== undefined || drive.spin === true) {
    const over = drive.over === undefined ? 1 : (part.def.behaviorConfig?.[drive.over] ?? 1);
    v = (drive.output !== undefined ? (output(drive.output) ?? 0) : spin()) / (over > 0 ? over : 1);
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
  /** For a voice whose drive asks for `contact`: how many of the parts that are on touch something. */
  grip?: number;
}

/** The mean level of the parts that are on, 0 to 1: what the voice's pitch and tone follow. */
export function meanLevel(g: Pick<LoopGroup, 'sum' | 'on'>): number {
  return g.on > 0 ? Math.min(1, g.sum / g.on) : 0;
}

export const MAX_LOOPS = 12;
/** Quieter than this at the ear, a loop is not worth a voice. */
export const LOOP_FLOOR = 0.003;

/** The groups that get a voice: the `max` loudest at the ear (`heard` is the ear's gain for a group, its voice's own loudness included). */
export function pickLoops(groups: readonly LoopGroup[], heard: (g: LoopGroup) => number, max = MAX_LOOPS): LoopGroup[] {
  return groups
    .map((g) => ({ g, loud: loopGain(g.sum) * heard(g) }))
    .filter((e) => e.loud >= LOOP_FLOOR)
    .sort((a, b) => b.loud - a.loud || (a.g.key < b.g.key ? -1 : 1))
    .slice(0, max)
    .map((e) => e.g);
}
