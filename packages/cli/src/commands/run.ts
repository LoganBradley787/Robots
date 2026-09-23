import { DriveTracker, formatIssues, sampleRobot, timelineInputs, validateBlueprint, World, type DriveMetrics, type Issue, type KeyPress, type RobotSample, type WorldFile } from '@robots/sim-core';

export interface RunOptions {
  seconds: number;
  seed: number;
  sampleEverySeconds?: number;
  /** Where the root part lands; default is the world's spawn point. */
  at?: { x: number; y: number };
  /** Keys pressed and released on the spawned robot, from tick 0. */
  keys?: readonly KeyPress[];
}

export interface RunReport {
  world: string;
  blueprint: string;
  seconds: number;
  seed: number;
  ticks: number;
  issues: Issue[];
  samples: RobotSample[];
  final: RobotSample;
  drive: DriveMetrics;
  finalHash: string;
}

export class InvalidBlueprint extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(formatIssues(issues));
    this.issues = issues;
  }
}

/** Validates, spawns, and steps the blueprint, sampling the robot once per `sampleEverySeconds`. */
export async function runSim(file: WorldFile, blueprint: unknown, opts: RunOptions): Promise<RunReport> {
  const world = await World.create({ seed: opts.seed }, file);
  try {
    const v = validateBlueprint(blueprint, world.registry);
    if (!v.ok) throw new InvalidBlueprint(v.issues);
    const robot = world.spawnBlueprint(blueprint, opts.at ?? file.spawn);
    if (opts.keys && opts.keys.length > 0 && !world.canControl(robot.id)) throw new Error(`${robot.name} has no core, so keys cannot control it`);
    const inputs = timelineInputs(opts.keys ?? [], robot.id, world.dt);
    const ticks = Math.round(opts.seconds / world.dt);
    const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 1) / world.dt));
    const samples: RobotSample[] = [];
    const drive = new DriveTracker();
    drive.add(sampleRobot(world, robot));
    for (let i = 0; i < ticks; i++) {
      const input = inputs.get(world.tick);
      world.step(input ? [input] : []);
      const s = sampleRobot(world, robot);
      drive.add(s);
      if (world.tick % every === 0) samples.push(s);
    }
    return {
      world: file.name,
      blueprint: robot.name,
      seconds: opts.seconds,
      seed: opts.seed,
      ticks,
      issues: v.issues,
      samples,
      final: sampleRobot(world, robot),
      drive: drive.result(),
      finalHash: world.hash(),
    };
  } finally {
    world.dispose();
  }
}

const f = (v: number, digits = 3): string => v.toFixed(digits);

export function formatSample(s: RobotSample): string {
  return `t=${f(s.time, 2).padStart(6)}  core x=${f(s.coreX)} y=${f(s.coreY)} tilt=${f(s.tiltDeg, 2)}  speed=${f(s.speed)}  resting=${s.resting ? 'yes' : 'no'}`;
}

export function formatReport(r: RunReport): string {
  const lines: string[] = [];
  if (r.issues.length > 0) lines.push(formatIssues(r.issues));
  for (const s of r.samples) lines.push(formatSample(s));
  const fin = r.final;
  lines.push(formatDrive(r.drive));
  lines.push(
    `final: ticks=${r.ticks} hash=${r.finalHash} resting=${fin.resting ? 'yes' : 'no'} core=(${f(fin.coreX)}, ${f(fin.coreY)}) tilt=${f(fin.tiltDeg, 2)} mass=${f(fin.massKg)} com=(${f(fin.comX)}, ${f(fin.comY)})`,
  );
  return lines.join('\n');
}

export function formatDrive(d: DriveMetrics): string {
  return `drive: distance ${f(d.distance, 2)} m   max altitude ${f(d.maxAltitude, 2)} m   max tilt ${f(d.maxTiltDeg, 1)} deg   top speed ${f(d.topSpeed, 2)} m/s`;
}
