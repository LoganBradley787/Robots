import { scriptHost } from '../scriptHost';
import { plotPaths } from '../report/plot';
import { Tracer, type PieceReport, type TraceEvent } from '../report/trace';
import { DriveTracker, keysScriptsRead, type World as SimWorld, formatIssues, sampleRobot, timelineInputs, validateBlueprint, World, type DriveMetrics, type Issue, type KeyPress, type RobotSample, type WorldFile } from '@robots/sim-core';

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
  /** M7: what happened, in order: keys, drops, decouplers, splits, wakes, parts lost, blasts, script logs and crashes. */
  events: TraceEvent[];
  /** M7: every robot seen, by letter (A is the spawned robot), with its path and final state. */
  pieces: PieceReport[];
  /** M7: an ASCII side view of every piece's path over the terrain. */
  plot: string[];
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
    const read = keysScriptsRead((v.blueprint?.scripts ?? []).map((sc) => (typeof sc.source === 'string' ? sc.source : '')));
    const warnings = read.any
      ? []
      : [...new Set((opts.keys ?? []).map((k) => k.key))]
          .filter((k) => !known.includes(k) && !read.keys.has(k))
          .map((k) => `key '${k}' does nothing on ${robot.name} (its keys: ${[...new Set([...known, ...read.keys])].join(', ') || 'none'})`);
    const ticks = Math.round(opts.seconds / world.dt);
    const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 1) / world.dt));
    const samples: RobotSample[] = [];
    const drive = new DriveTracker();
    const tracer = new Tracer(world, robot, opts.keys ?? [], Math.max(1, Math.round(0.1 / world.dt)));
    let last = sampleRobot(world, robot);
    drive.add(last);
    for (let i = 0; i < ticks; i++) {
      while (drops.length > 0 && Math.round((drops[0]?.t ?? 0) / world.dt) <= world.tick) {
        const d = drops.shift() as Drop;
        tracer.dropped(world.spawnBlueprint(d.blueprint, d.at), d.name);
      }
      tracer.beforeStep();
      world.step(inputs.get(world.tick) ?? []);
      tracer.afterStep();
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
      ...traced(tracer, file),
    };
  } finally {
    world.dispose();
  }
}

function traced(tracer: Tracer, file: WorldFile): Pick<RunReport, 'events' | 'pieces' | 'plot'> {
  const { pieces, events, blasts } = tracer.finish();
  const plot = plotPaths({ world: file, tracks: pieces.map((p) => ({ mark: p.mark, points: p.track, shape: p.finalParts })), blasts });
  return { events, pieces, plot };
}

export { keysScriptsRead };

const f = (v: number, digits = 3): string => v.toFixed(digits);

/** Events shown in the text report; `--json` has them all. */
const EVENTS_SHOWN = 60;

export function formatSample(s: RobotSample): string {
  return `t=${f(s.time, 2).padStart(6)}  core x=${f(s.coreX)} y=${f(s.coreY)} tilt=${f(s.tiltDeg, 2)}  speed=${f(s.speed)}  resting=${s.resting ? 'yes' : 'no'}`;
}

export function formatReport(r: RunReport): string {
  const lines: string[] = [];
  if (r.issues.length > 0) lines.push(formatIssues(r.issues));
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  for (const c of r.scriptCrashes) lines.push(`script ${c.script} stopped at t=${f(c.t, 2)}s (${c.kind}): ${c.message}`);
  lines.push('robot A, once per second:');
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
  if (r.events.length > 0) {
    lines.push('events (A is the robot; other letters are pieces and drops, listed below):');
    for (const e of r.events.slice(0, EVENTS_SHOWN)) lines.push(formatEvent(e));
    if (r.events.length > EVENTS_SHOWN) lines.push(`  ... and ${r.events.length - EVENTS_SHOWN} more events (--json has them all)`);
  }
  if (r.pieces.length > 1) lines.push(...formatPieces(r.pieces));
  lines.push(...r.plot);
  lines.push(
    `final: ticks=${r.ticks} hash=${r.finalHash} resting=${fin.resting ? 'yes' : 'no'} core=(${f(fin.coreX)}, ${f(fin.coreY)}) tilt=${f(fin.tiltDeg, 2)} mass=${f(fin.massKg)} com=(${f(fin.comX)}, ${f(fin.comY)})`,
  );
  return lines.join('\n');
}

export function formatEvent(e: TraceEvent): string {
  const again = e.repeats ? ` (and ${e.repeats} more time${e.repeats === 1 ? '' : 's'} until t=${f(e.until ?? e.t, 2)})` : '';
  return `  t=${f(e.t, 2).padStart(6)}  ${e.robot}  ${e.text}${again}`;
}

/** Robots with a core and drops get a line each; core-less debris is counted. */
export function formatPieces(pieces: readonly PieceReport[]): string[] {
  const lines = ['pieces:'];
  const debris: string[] = [];
  for (const p of pieces) {
    if (p.mark !== 'A' && p.dropped === undefined && p.core === 'no core') {
      debris.push(p.mark);
      continue;
    }
    const origin = p.dropped !== undefined ? `dropped ${p.dropped}` : p.from !== undefined ? `broke off ${p.from} at t=${f(p.appearedAt, 2)}` : p.name;
    const s = p.final;
    const where = `(${f(s.x, 2)}, ${f(s.y, 2)})`;
    const state =
      p.goneAt !== undefined
        ? `gone at t=${f(p.goneAt, 2)}, last seen at ${where}`
        : `at ${where} tilt ${f(s.tiltDeg, 1)} speed ${f(s.speed, 2)}${s.resting ? ' resting' : ''}, ${s.parts} part${s.parts === 1 ? '' : 's'}${s.energy ? `, energy ${f(s.energy.stored, 0)} of ${f(s.energy.capacity, 0)} J` : ''}`;
    lines.push(`  ${p.mark}  ${origin}, ${p.core}: ${state}`);
  }
  if (debris.length > 0) lines.push(`  and ${debris.length} piece${debris.length === 1 ? '' : 's'} with no core: ${debris.join(', ')}`);
  return lines;
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
