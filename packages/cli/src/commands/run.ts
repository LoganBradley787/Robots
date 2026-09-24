import { scriptHost } from '../scriptHost';
import { DriveTracker, type World as SimWorld, formatIssues, sampleRobot, timelineInputs, validateBlueprint, World, type DriveMetrics, type Issue, type KeyPress, type RobotSample, type WorldFile } from '@robots/sim-core';

export interface RunOptions {
  seconds: number;
  seed: number;
  sampleEverySeconds?: number;
  /** Where the root part lands; default is the world's spawn point. */
  at?: { x: number; y: number };
  /** Keys pressed and released on the spawned robot, from tick 0. */
  keys?: readonly KeyPress[];
  /** Unlimited energy from tick 0. */
  unlimited?: boolean;
  /** Other blueprints spawned mid-run (a bomb dropped on the robot). */
  drops?: readonly Drop[];
}

/** A blueprint spawned at `t` seconds with its root part at `at`. */
export interface Drop {
  name: string;
  blueprint: unknown;
  t: number;
  at: { x: number; y: number };
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
  energy: { used: number; remaining: number; capacity: number; ranDryAt?: number };
  finalHash: string;
  /** Things that ran but probably not as meant, like a timeline key the robot has no control on. */
  warnings: string[];
  /** Scripts that stopped, with when and why. */
  scriptCrashes: { script: string; t: number; kind: string; message: string }[];
  /** What broke (M6): parts destroyed anywhere, blasts, and how many pieces the robot is in now (0: all gone). */
  destruction: { destroyed: string[]; explosions: number; pieces: number };
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
  const world = await World.create({ seed: opts.seed, scripts: await scriptHost() }, file);
  try {
    const v = validateBlueprint(blueprint, world.registry);
    if (!v.ok) throw new InvalidBlueprint(v.issues);
    for (const d of opts.drops ?? []) {
      const dv = validateBlueprint(d.blueprint, world.registry);
      if (!dv.ok) throw new InvalidBlueprint(dv.issues);
    }
    const robot = world.spawnBlueprint(blueprint, opts.at ?? file.spawn);
    const drops = [...(opts.drops ?? [])].sort((a, b) => a.t - b.t);
    if (opts.unlimited) world.setUnlimitedEnergy(true);
    if (opts.keys && opts.keys.length > 0 && !world.canControl(robot.id)) throw new Error(`${robot.name} has no core, so keys cannot control it`);
    const inputs = timelineInputs(opts.keys ?? [], robot.id, world.dt);
    const known = world.controller(robot.id)?.keys ?? [];
    const warnings = [...new Set((opts.keys ?? []).map((k) => k.key))]
      .filter((k) => !known.includes(k))
      .map((k) => `key '${k}' does nothing on ${robot.name} (its keys: ${known.join(', ') || 'none'})`);
    const ticks = Math.round(opts.seconds / world.dt);
    const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 1) / world.dt));
    const samples: RobotSample[] = [];
    const drive = new DriveTracker();
    let last = sampleRobot(world, robot);
    drive.add(last);
    for (let i = 0; i < ticks; i++) {
      while (drops.length > 0 && Math.round((drops[0]?.t ?? 0) / world.dt) <= world.tick) {
        const d = drops.shift() as Drop;
        world.spawnBlueprint(d.blueprint, d.at);
      }
      world.step(inputs.get(world.tick) ?? []);
      // A robot blown to nothing has no pose: its report ends where it was last seen.
      if (!world.robots.includes(robot)) continue;
      last = sampleRobot(world, robot);
      drive.add(last);
      if (world.tick % every === 0) samples.push(last);
    }
    return {
      world: file.name,
      blueprint: robot.name,
      seconds: opts.seconds,
      seed: opts.seed,
      ticks,
      issues: v.issues,
      samples,
      final: last,
      drive: drive.result(),
      energy: energyOf(world, robot.id),
      warnings,
      scriptCrashes: world.events.flatMap((e) => (e.kind === 'scriptCrashed' ? [{ script: e.script, t: e.tick * world.dt, kind: e.error.kind, message: e.error.message }] : [])),
      destruction: destructionOf(world, robot.id),
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
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  for (const c of r.scriptCrashes) lines.push(`script ${c.script} stopped at t=${f(c.t, 2)}s (${c.kind}): ${c.message}`);
  for (const s of r.samples) lines.push(formatSample(s));
  const fin = r.final;
  lines.push(formatDrive(r.drive));
  lines.push(formatEnergy(r.energy));
  const d = r.destruction;
  if (d.destroyed.length > 0 || d.explosions > 0) {
    const shown = d.destroyed.slice(0, 12).join(', ') + (d.destroyed.length > 12 ? `, and ${d.destroyed.length - 12} more` : '');
    const pieces = d.pieces === 0 ? 'the robot is gone' : `the robot is in ${d.pieces} piece${d.pieces === 1 ? '' : 's'}`;
    lines.push(`destruction: ${d.destroyed.length} part${d.destroyed.length === 1 ? '' : 's'} destroyed (${shown})   ${d.explosions} explosion${d.explosions === 1 ? '' : 's'}   ${pieces}`);
  }
  lines.push(
    `final: ticks=${r.ticks} hash=${r.finalHash} resting=${fin.resting ? 'yes' : 'no'} core=(${f(fin.coreX)}, ${f(fin.coreY)}) tilt=${f(fin.tiltDeg, 2)} mass=${f(fin.massKg)} com=(${f(fin.comX)}, ${f(fin.comY)})`,
  );
  return lines.join('\n');
}

export function formatDrive(d: DriveMetrics): string {
  return `drive: distance ${f(d.distance, 2)} m   max altitude ${f(d.maxAltitude, 2)} m   max tilt ${f(d.maxTiltDeg, 1)} deg   top speed ${f(d.topSpeed, 2)} m/s`;
}

/** Parts destroyed and blasts over the whole world; pieces are the robot and every piece that broke off it. */
export function destructionOf(world: SimWorld, robotId: number): RunReport['destruction'] {
  const family = new Set([robotId]);
  // Pieces come after the robot they broke from, so one pass in order finds pieces of pieces.
  for (const r of world.robots) if (r.brokeFrom !== undefined && family.has(r.brokeFrom)) family.add(r.id);
  return {
    destroyed: world.events.flatMap((e) => (e.kind === 'partDestroyed' ? [e.part] : [])),
    explosions: world.events.filter((e) => e.kind === 'explosion').length,
    pieces: world.robots.filter((r) => family.has(r.id)).length,
  };
}

export function energyOf(world: SimWorld, robotId: number): RunReport['energy'] {
  const e = world.energy(robotId);
  const dry = world.events.find((ev) => ev.robot === robotId && ev.kind === 'energyEmpty');
  return { used: e?.used ?? 0, remaining: e?.stored ?? 0, capacity: e?.capacity ?? 0, ...(dry ? { ranDryAt: dry.tick * world.dt } : {}) };
}

export function formatEnergy(e: RunReport['energy']): string {
  return `energy: used ${f(e.used, 1)}   remaining ${f(e.remaining, 1)} of ${f(e.capacity, 0)}${e.ranDryAt !== undefined ? `   ran dry at t=${f(e.ranDryAt, 2)}s` : ''}`;
}
