import { scriptHost } from '../scriptHost';
import { plotPaths } from '../report/plot';
import { Tracer, type PieceReport, type TraceEvent } from '../report/trace';
import { DriveTracker, keysScriptsRead, type World as SimWorld, formatIssues, sampleRobot, timelineInputs, validateBlueprint, World, type DriveMetrics, type Issue, type KeyPress, type Robot, type RobotSample, type WorldFile, type WorldOptions } from '@robots/sim-core';

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
  /** The robot's team (M8); 0 when absent. */
  team?: number;
  /** Tests (M9): a script host in place of the default, and the world's `scriptProbe`. */
  world?: Pick<WorldOptions, 'scripts' | 'scriptProbe'>;
}

/** A blueprint spawned at `t` seconds with its root part at `at`. */
export interface Drop {
  name: string;
  blueprint: unknown;
  t: number;
  at: { x: number; y: number };
  /** Team (M8); 0 when absent. */
  team?: number;
}

export interface RunReport {
  world: string;
  blueprint: string;
  seconds: number;
  seed: number;
  ticks: number;
  issues: Issue[];
  samples: RobotSample[];
  /** M7 (Gate 6): each aiming joint's angle in degrees at every sample, same order as `samples`; absent without any. */
  aims?: Record<string, number>[];
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
  /** M13: shells the robot's guns fired, how many hit something and for how much, and hits it took. Absent without either. */
  guns?: { shots: number; hits: number; damage: number; taken: number };
  /** M7: what happened, in order: keys, drops, decouplers, splits, wakes, parts lost, blasts, script logs and crashes. */
  events: TraceEvent[];
  /** M7: every robot seen, by letter (A is the spawned robot), with its path and final state. */
  pieces: PieceReport[];
  /** M7: an ASCII side view of every piece's path over the terrain. */
  plot: string[];
  /** M8: wall-clock milliseconds per tick on this machine (scripts are most of it), for spotting slow robots. */
  timing: { avgMs: number; worstMs: number };
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
  const world = await World.create({ seed: opts.seed, scripts: await scriptHost(), ...opts.world }, file);
  try {
    const v = validateBlueprint(blueprint, world.registry);
    if (!v.ok) throw new InvalidBlueprint(v.issues);
    for (const d of opts.drops ?? []) {
      const dv = validateBlueprint(d.blueprint, world.registry);
      if (!dv.ok) throw new InvalidBlueprint(dv.issues);
    }
    const robot = world.spawnBlueprint(blueprint, opts.at ?? file.spawn, { team: opts.team ?? 0 });
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
    const aims: Record<string, number>[] = [];
    const drive = new DriveTracker();
    const tracer = new Tracer(world, robot, opts.keys ?? [], Math.max(1, Math.round(0.1 / world.dt)));
    let last = sampleRobot(world, robot);
    drive.add(last);
    let totalMs = 0;
    let worstMs = 0;
    for (let i = 0; i < ticks; i++) {
      while (drops.length > 0 && Math.round((drops[0]?.t ?? 0) / world.dt) <= world.tick) {
        const d = drops.shift() as Drop;
        tracer.dropped(world.spawnBlueprint(d.blueprint, d.at, { team: d.team ?? 0 }), d.name);
      }
      tracer.beforeStep();
      const t0 = performance.now();
      world.step(inputs.get(world.tick) ?? []);
      const took = performance.now() - t0;
      totalMs += took;
      worstMs = Math.max(worstMs, took);
      tracer.afterStep();
      // A robot blown to nothing has no pose: its report ends where it was last seen.
      if (!world.robots.includes(robot)) continue;
      last = sampleRobot(world, robot);
      drive.add(last);
      if (world.tick % every === 0) {
        samples.push(last);
        aims.push(aimsOf(world, robot));
      }
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
      ...gunsOf(world, robot.id),
      ...(aims.some((a) => Object.keys(a).length > 0) ? { aims } : {}),
      finalHash: world.hash(),
      timing: { avgMs: ticks > 0 ? totalMs / ticks : 0, worstMs },
      ...traced(tracer, file),
    };
  } finally {
    world.dispose();
  }
}

/**
 * Where each position-motor joint (a rotator) points, in degrees from how it was built (counterclockwise positive), from
 * its `angle` output (-1 to 1 of its range): the turret's aim, which the core's path does not show.
 */
function aimsOf(world: SimWorld, robot: Robot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, p] of robot.parts) {
    const range = p.def.behaviorConfig?.range;
    if (p.def.joint?.motor !== 'position' || range === undefined) continue;
    const v = world.partOutput(robot.id, id, 'angle');
    if (v !== undefined) out[id] = (v * range * 180) / Math.PI;
  }
  return out;
}

function traced(tracer: Tracer, file: WorldFile): Pick<RunReport, 'events' | 'pieces' | 'plot'> {
  const { pieces, events, blasts } = tracer.finish();
  const plot = plotPaths({ world: file, tracks: pieces.map((p) => ({ mark: p.mark, points: p.track, shape: p.finalParts, marks: p.marks })), blasts });
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
  r.samples.forEach((s, i) => {
    const a = Object.entries(r.aims?.[i] ?? {});
    lines.push(formatSample(s) + (a.length > 0 ? `  aim ${a.map(([id, deg]) => `${id} ${f(deg, 1)}`).join(', ')}` : ''));
  });
  const fin = r.final;
  lines.push(formatDrive(r.drive));
  lines.push(formatEnergy(r.energy));
  lines.push(`time per tick on this machine: ${f(r.timing.avgMs, 2)} ms average, ${f(r.timing.worstMs, 2)} ms worst (the browser has 16.7 ms per frame; scripts are most of it)`);
  const d = r.destruction;
  if (d.destroyed.length > 0 || d.explosions > 0) {
    const shown = d.destroyed.slice(0, 12).join(', ') + (d.destroyed.length > 12 ? `, and ${d.destroyed.length - 12} more` : '');
    const pieces = d.pieces === 0 ? 'the robot is gone' : `the robot is in ${d.pieces} piece${d.pieces === 1 ? '' : 's'}`;
    lines.push(`destruction: ${d.destroyed.length} part${d.destroyed.length === 1 ? '' : 's'} destroyed (${shown})   ${d.explosions} explosion${d.explosions === 1 ? '' : 's'}   ${pieces}`);
  }
  if (r.guns) lines.push(`guns: fired ${r.guns.shots} shell${r.guns.shots === 1 ? '' : 's'}, ${r.guns.hits} hit (${r.guns.damage} damage)   took ${r.guns.taken} hit${r.guns.taken === 1 ? '' : 's'}`);
  if (r.events.length > 0) {
    lines.push('events (A is the robot; other letters are pieces and drops, listed below):');
    for (const e of r.events.slice(0, EVENTS_SHOWN)) lines.push(formatEvent(e));
    if (r.events.length > EVENTS_SHOWN) lines.push(`  ... and ${r.events.length - EVENTS_SHOWN} more events (--json has them all)`);
  }
  if (r.pieces.length > 1 || r.pieces.some((p) => p.team !== 0 || p.marks.length > 0)) lines.push(...formatPieces(r.pieces));
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
    const team = p.team === 0 ? '' : p.team === 1 ? ' [enemy]' : ` [team ${p.team}]`;
    const marks = p.marks.length > 0 ? `; marked ${p.marks.map((m) => `${m.label !== undefined ? `${m.label} ` : ''}(${f(m.x, 1)}, ${f(m.y, 1)})`).join(', ')}` : '';
    lines.push(`  ${p.mark}${team}  ${origin}, ${p.core}: ${state}${marks}`);
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
    // A flare burning out (M11) is not a part lost.
    destroyed: world.events.flatMap((e) => (e.kind === 'partDestroyed' && e.burntOut !== true ? [e.part] : [])),
    explosions: world.events.filter((e) => e.kind === 'explosion').length,
    pieces: world.robots.filter((r) => family.has(r.id)).length,
  };
}

/** M13: the robot's shooting and what it took, or nothing when it neither fired nor was hit. */
function gunsOf(world: SimWorld, robotId: number): { guns?: RunReport['guns'] } {
  const shots = world.shotsBy(robotId);
  let hits = 0;
  let damage = 0;
  let taken = 0;
  for (const e of world.events) {
    if (e.kind !== 'shellHit') continue;
    if (e.by === robotId) {
      hits++;
      damage += e.damage;
    }
    if (e.robot === robotId) taken++;
  }
  return shots > 0 || taken > 0 ? { guns: { shots, hits, damage, taken } } : {};
}

export function energyOf(world: SimWorld, robotId: number): RunReport['energy'] {
  const e = world.energy(robotId);
  const dry = world.events.find((ev) => ev.robot === robotId && ev.kind === 'energyEmpty');
  return { used: e?.used ?? 0, remaining: e?.stored ?? 0, capacity: e?.capacity ?? 0, ...(dry ? { ranDryAt: dry.tick * world.dt } : {}) };
}

export function formatEnergy(e: RunReport['energy']): string {
  return `energy: used ${f(e.used, 1)}   remaining ${f(e.remaining, 1)} of ${f(e.capacity, 0)}${e.ranDryAt !== undefined ? `   ran dry at t=${f(e.ranDryAt, 2)}s` : ''}`;
}
