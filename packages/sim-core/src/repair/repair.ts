import { footprintOf } from '../parts/footprint';
import { faceDir, opposite, rotateCell, rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';
import type { AssemblyPart } from '../assembly/assemble';
import { newPart } from '../assembly/spawn';
import type { PlacedPart } from '../blueprint/types';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StateHasher } from '../replay/StateHasher';
import type { WorldEvent } from '../world/World';
import type { PartInstance, Robot } from '../world/Robot';
import { partLists } from '../world/partLists';
import { createCost, healCost, jobSeconds, JOBS_AT_ONCE, SCRAP_TIME, scrapGives, START_HEALTH, worth } from './numbers';
import { cos, sin } from '../math/fdlibm';

/**
 * Repair paid in parts: a robot's script scraps parts of its own robot into a tank and builds or heals other parts
 * with what it holds. There is no repair logic here, only the orders a script gives: what is scrapped, made, and in
 * what order is each robot's own script's business. What is on the robot is all there is, so every trade leaves a
 * little less (`repair/numbers.ts` has the prices). The tank has no weight and stays with the piece that keeps the
 * active core; a wreck runs no jobs.
 */

export type RepairKind = 'scrap' | 'build' | 'heal';

/** One job under way. Simulation state, hashed. */
export interface RepairJob {
  kind: RepairKind;
  /** The part's id. */
  part: string;
  /** Build only: the part being made, and the live part it goes on (for drawing; finishing it looks again). */
  placed?: PlacedPart;
  home?: string;
  /** Scrap and build: ticks left, of `ticks`. A heal runs until its part reaches `to`. */
  left: number;
  ticks: number;
  /** Build: what it took from the tank, handed back if it cannot finish. */
  paid: number;
  /** Heal: the share of full health to stop at, and the share a tick adds. */
  to: number;
  rate: number;
}

/** What a robot has of repair. Absent until its script first gets an order through. */
export interface RepairState {
  tank: number;
  jobs: RepairJob[];
}

/** What repair needs of the world. */
export interface RepairHost {
  physics: PhysicsWorld;
  registry: PartRegistry;
  dt: number;
  tick: number;
  readonly robots: readonly Robot[];
  readonly events: WorldEvent[];
  /** Whether a core is in charge of the robot. */
  controlled(robot: Robot): boolean;
  /** A live part's pose: where its origin cell is, and its body's angle. */
  pose(robot: Robot, part: PartInstance): { x: number; y: number; angle: number };
  /** The robot lost a part: rebuild it. */
  shrank(robot: Robot): void;
  /** The robot gained a part: rebuild it, and its controller with it. */
  grew(robot: Robot): void;
  /** `own()`'s answer, as JSON text. */
  own(robot: Robot, opts: unknown): string;
}

/**
 * The one check on what a robot may make: a part of its own blueprint it has lost, and not a copy a bay made. A piece
 * that broke off and woke is only what was placed as its own scope, not the robot it left. Nothing else assumes this:
 * everything past here takes a placed part, so a robot can one day make what it never had by changing this check.
 */
function mayMake(robot: Robot, placed: PlacedPart, index: number): boolean {
  if (robot.parts.has(placed.id) || index >= (robot.firstCopy ?? Infinity)) return false;
  return robot.brokeFrom === undefined || (robot.scope !== undefined && placed.tags[0] === robot.scope);
}

/** A cell's number, for looking its neighbors up. */
const cellKey = (x: number, y: number): number => x * 65536 + y;

/** A part's cells in blueprint coordinates with the faces it attaches through there, as assembly reads them. */
function cellsOf(part: AssemblyPart): { x: number; y: number; faces: readonly Face[] }[] {
  return (part.footprint ?? part.def.footprint).map((fc) => {
    const off = rotateCell(fc, part.rot);
    const raw = part.holding === true && fc.grips ? [...fc.faces, ...fc.grips] : fc.faces;
    const faces = raw.map((f) => rotateFace(f, part.rot)).filter((f) => part.cut?.includes(f) !== true);
    return { x: part.x + off.x, y: part.y + off.y, faces };
  });
}

/** Each robot's live cells, kept until it changes. Derived, never hashed. */
const liveCells = new WeakMap<Robot, { version: number; parts: Robot['parts']; size: number; at: Map<number, { part: PartInstance; faces: readonly Face[] }> }>();

function cellsOfRobot(robot: Robot): Map<number, { part: PartInstance; faces: readonly Face[] }> {
  const had = liveCells.get(robot);
  if (had && had.version === robot.version && had.parts === robot.parts && had.size === robot.parts.size) return had.at;
  const at = new Map<number, { part: PartInstance; faces: readonly Face[] }>();
  for (const part of robot.parts.values()) for (const c of cellsOf(part)) at.set(cellKey(c.x, c.y), { part, faces: c.faces });
  liveCells.set(robot, { version: robot.version, parts: robot.parts, size: robot.parts.size, at });
  return at;
}

function placedCells(registry: PartRegistry, placed: PlacedPart): { x: number; y: number; faces: readonly Face[] }[] {
  const def = registry.get(placed.part);
  return cellsOf({ id: placed.id, def, x: placed.x, y: placed.y, rot: placed.rot, footprint: footprintOf(def, placed.size) });
}

/** The live part a placed part would attach to, by the rule assembly goes by: two faces that meet. Undefined for none. */
function homeOf(registry: PartRegistry, robot: Robot, placed: PlacedPart): PartInstance | undefined {
  const live = cellsOfRobot(robot);
  for (const c of placedCells(registry, placed)) {
    for (const f of c.faces) {
      const d = faceDir(f);
      const there = live.get(cellKey(c.x + d.x, c.y + d.y));
      if (there?.faces.includes(opposite(f))) return there.part;
    }
  }
  return undefined;
}

/**
 * The live part a placed part can go on right now, or why it cannot. It goes in the frame of what it attaches to, so a
 * part on a turned rotator or a piston's moving side comes back where that side is now. A cell must be empty in the
 * world: a ball a little smaller than a cell on each, as a bay checks its hollow, so anything there says no, a swung
 * turret of its own included.
 */
function fit(host: RepairHost, robot: Robot, placed: PlacedPart): PartInstance | string {
  const home = homeOf(host.registry, robot, placed);
  if (!home) return 'not touching';
  const pose = host.pose(robot, home);
  const c = cos(pose.angle);
  const s = sin(pose.angle);
  const probes = placedCells(host.registry, placed).map((cell) => {
    const dx = cell.x - home.x;
    const dy = cell.y - home.y;
    return { x: pose.x + c * dx - s * dy, y: pose.y + s * dx + c * dy, shape: { shape: 'ball' as const, radius: 0.45 } };
  });
  return host.physics.overlapsShapes(probes) ? 'blocked' : home;
}

/** A job's ticks, at least one. */
function ticksFor(seconds: number, dt: number): number {
  return Math.max(1, Math.ceil(seconds / dt));
}

function startJob(robot: Robot, job: RepairJob): void {
  (robot.repair ??= { tank: 0, jobs: [] }).jobs.push(job);
}

type Order = { ok: true; seconds: number; cost: number } | { ok: false; why: string };

/** Why no more jobs can start on this part, if so. */
function busy(robot: Robot, id: string): string | undefined {
  const jobs = robot.repair?.jobs ?? [];
  return jobs.length >= JOBS_AT_ONCE || jobs.some((j) => j.part === id) ? 'busy' : undefined;
}

/** A part a script may scrap or heal: on its robot and not sealed in a bay, whose copies cost nothing but energy. */
function ownPart(robot: Robot, id: string): PartInstance | string {
  const part = robot.parts.get(id);
  if (!part) return 'not on this robot';
  return partLists(robot).sealed.has(id) ? 'held in a bay' : part;
}

function scrap(host: RepairHost, robot: Robot, id: string): Order {
  const part = ownPart(robot, id);
  if (typeof part === 'string') return { ok: false, why: part };
  const why = busy(robot, id);
  if (why !== undefined) return { ok: false, why };
  const seconds = jobSeconds(part.def, part.footprint) * SCRAP_TIME;
  const ticks = ticksFor(seconds, host.dt);
  startJob(robot, { kind: 'scrap', part: id, left: ticks, ticks, paid: 0, to: 0, rate: 0 });
  return { ok: true, seconds, cost: 0 };
}

function build(host: RepairHost, robot: Robot, id: string): Order {
  const index = robot.blueprint.parts.findIndex((p) => p.id === id);
  const placed = robot.blueprint.parts[index];
  if (!placed || !mayMake(robot, placed, index)) return { ok: false, why: 'not a lost part' };
  const why = busy(robot, id);
  if (why !== undefined) return { ok: false, why };
  const def = host.registry.get(placed.part);
  const cost = createCost(worth(def, footprintOf(def, placed.size)));
  if ((robot.repair?.tank ?? 0) < cost) return { ok: false, why: 'tank short' };
  const home = fit(host, robot, placed);
  if (typeof home === 'string') return { ok: false, why: home };
  (robot.repair as RepairState).tank -= cost;
  const seconds = jobSeconds(def, footprintOf(def, placed.size));
  const ticks = ticksFor(seconds, host.dt);
  startJob(robot, { kind: 'build', part: id, placed, home: home.id, left: ticks, ticks, paid: cost, to: 0, rate: 0 });
  return { ok: true, seconds, cost };
}

function heal(host: RepairHost, robot: Robot, id: string, upTo: number): Order {
  const part = ownPart(robot, id);
  if (typeof part === 'string') return { ok: false, why: part };
  const why = busy(robot, id);
  if (why !== undefined) return { ok: false, why };
  const to = Math.min(1, upTo);
  if (!(part.health < to * part.def.health)) return { ok: false, why: 'full' };
  if ((robot.repair?.tank ?? 0) <= 0) return { ok: false, why: 'tank short' };
  const seconds = jobSeconds(part.def, part.footprint);
  const gained = to - part.health / part.def.health;
  startJob(robot, { kind: 'heal', part: id, left: 0, ticks: 0, paid: 0, to, rate: host.dt / seconds });
  return { ok: true, seconds: seconds * gained, cost: healCost(worth(part.def, part.footprint), gained) };
}

/** Stops every job. A build not finished hands back what it took; a heal keeps what it gained. */
function stop(robot: Robot): void {
  const r = robot.repair;
  if (!r) return;
  for (const j of r.jobs) r.tank += j.paid;
  r.jobs = [];
}

function finishBuild(host: RepairHost, robot: Robot, job: RepairJob, placed: PlacedPart): void {
  const home = fit(host, robot, placed);
  if (typeof home === 'string') {
    (robot.repair as RepairState).tank += job.paid;
    host.events.push({ tick: host.tick, robot: robot.id, kind: 'repairFailed', part: job.part, why: home });
    return;
  }
  const def = host.registry.get(placed.part);
  const part = newPart(def, placed);
  part.health = def.health * START_HEALTH;
  // The tank pays for the part, not for what a container holds.
  if (part.stored !== undefined) part.stored = 0;
  part.group = home.group;
  part.localX = home.localX + placed.x - home.x;
  part.localY = home.localY + placed.y - home.y;
  // `Robot.parts` stays in blueprint order: the part goes back in its place, not last.
  const parts: Robot['parts'] = new Map();
  for (const p of robot.blueprint.parts) {
    const live = p.id === placed.id ? part : robot.parts.get(p.id);
    if (live) parts.set(p.id, live);
  }
  robot.parts = parts;
  host.grew(robot);
  const pose = host.pose(robot, part);
  host.events.push({ tick: host.tick, robot: robot.id, kind: 'partRebuilt', part: part.id, partType: def.id, x: pose.x, y: pose.y, cost: job.paid });
}

/** A job's tick. True when it is over. */
function runJob(host: RepairHost, robot: Robot, r: RepairState, job: RepairJob): boolean {
  if (job.kind === 'build') {
    if (--job.left > 0) return false;
    finishBuild(host, robot, job, job.placed as PlacedPart);
    return true;
  }
  const part = robot.parts.get(job.part);
  // Gone, shot away, or left with a piece that broke off: the job goes with it.
  if (!part || part.health <= 0) return true;
  const juice = worth(part.def, part.footprint);
  if (job.kind === 'scrap') {
    if (--job.left > 0) return false;
    const gave = scrapGives(juice, part.health / part.def.health);
    r.tank += gave;
    const pose = host.pose(robot, part);
    robot.parts.delete(part.id);
    host.shrank(robot);
    host.events.push({ tick: host.tick, robot: robot.id, kind: 'partScrapped', part: part.id, partType: part.def.id, x: pose.x, y: pose.y, gave });
    return true;
  }
  const had = part.health / part.def.health;
  const want = Math.min(job.rate, job.to - had);
  if (want <= 0) return true;
  const cost = healCost(juice, want);
  const paid = Math.min(cost, r.tank);
  r.tank -= paid;
  part.health = (had + (cost > 0 ? (want * paid) / cost : want)) * part.def.health;
  if (paid < cost || want < job.rate) {
    host.events.push({ tick: host.tick, robot: robot.id, kind: 'partHealed', part: part.id, health: part.health });
    return true;
  }
  return false;
}

/** Every robot's jobs, one tick on. In the damage phase, so what they change is rebuilt with the rest. */
export function runRepairs(host: RepairHost): void {
  for (const robot of host.robots) {
    const r = robot.repair;
    if (!r) continue;
    if (!host.controlled(robot)) {
      delete robot.repair;
      continue;
    }
    if (r.jobs.length > 0) r.jobs = r.jobs.filter((job) => !runJob(host, robot, r, job));
  }
}

/** One lost part as a script reads it from `lost()`. */
export interface LostPart {
  id: string;
  type: string;
  tags: readonly string[];
  /** Its cell, and how it was built turned. */
  x: number;
  y: number;
  rot: number;
  /** What it is worth, what creating it costs, what healing it from nothing costs, and the seconds for each. */
  juice: number;
  create: number;
  heal: number;
  seconds: number;
  /** Whether it touches the living robot right now. */
  touching: boolean;
}

/** `lost(opts)`: the lost parts in blueprint order, those named by `of` (ids, types, or tags), those `touching` if asked. */
function lostParts(host: RepairHost, robot: Robot, opts: unknown): LostPart[] | string {
  const o = (opts ?? {}) as { of?: unknown; touching?: unknown };
  if (typeof o !== 'object' || Object.keys(o).some((k) => k !== 'of' && k !== 'touching')) return "lost(): the options are 'of' and 'touching'";
  const of = o.of === undefined ? undefined : Array.isArray(o.of) ? (o.of as unknown[]) : [o.of];
  const out: LostPart[] = [];
  robot.blueprint.parts.forEach((placed, index) => {
    if (!mayMake(robot, placed, index)) return;
    if (of && !of.some((n) => n === placed.id || n === placed.part || placed.tags.includes(n as string))) return;
    const touching = homeOf(host.registry, robot, placed) !== undefined;
    if (o.touching === true && !touching) return;
    const def = host.registry.get(placed.part);
    const cells = footprintOf(def, placed.size);
    const juice = worth(def, cells);
    out.push({ id: placed.id, type: placed.part, tags: placed.tags, x: placed.x, y: placed.y, rot: placed.rot, juice, create: createCost(juice), heal: healCost(juice, 1 - START_HEALTH), seconds: jobSeconds(def, cells), touching });
  });
  return out;
}

/** A job as a script reads it from `job()`, seconds left on it included. */
function jobReading(host: RepairHost, robot: Robot): unknown {
  const job = robot.repair?.jobs[0];
  if (!job) return null;
  if (job.kind !== 'heal') return { kind: job.kind, part: job.part, left: job.left * host.dt, seconds: job.ticks * host.dt };
  const part = robot.parts.get(job.part);
  const gained = part ? job.to - part.health / part.def.health : 0;
  return { kind: job.kind, part: job.part, left: (gained / job.rate) * host.dt, seconds: host.dt / job.rate };
}

/**
 * A script's call: an order or a reading, its arguments as JSON text. The answer is JSON text; a line starting with '!'
 * is what is wrong with the options, which the prelude logs.
 */
export function repairCall(host: RepairHost, robot: Robot, op: string, text: string): string {
  let arg: unknown;
  try {
    arg = JSON.parse(text);
  } catch {
    return `!${op}(): the options could not be read`;
  }
  const args = Array.isArray(arg) ? (arg as unknown[]) : [];
  const id = String(args[0]);
  switch (op) {
    case 'scrap':
      return JSON.stringify(scrap(host, robot, id));
    case 'build':
      return JSON.stringify(build(host, robot, id));
    case 'heal':
      return JSON.stringify(heal(host, robot, id, typeof args[1] === 'number' && Number.isFinite(args[1]) ? args[1] : 1));
    case 'stop':
      stop(robot);
      return 'null';
    case 'tank':
      return JSON.stringify(robot.repair?.tank ?? 0);
    case 'job':
      return JSON.stringify(jobReading(host, robot));
    case 'lost': {
      const list = lostParts(host, robot, arg);
      return typeof list === 'string' ? `!${list}` : JSON.stringify(list);
    }
    case 'own':
      return host.own(robot, arg);
    default:
      return 'null';
  }
}

/** A job as the app draws it, and how far along it is, 0 to 1. */
export interface RepairView {
  robot: number;
  kind: RepairKind;
  part: string;
  /** The body it is on, its cells in the world, and that body's angle. */
  body: number;
  cells: { x: number; y: number }[];
  angle: number;
  done: number;
}

/** Every job under way, for drawing and sound. Read only. */
export function repairViews(host: RepairHost): RepairView[] {
  const out: RepairView[] = [];
  for (const robot of host.robots) {
    for (const job of robot.repair?.jobs ?? []) {
      const at = job.placed ? robot.parts.get(job.home ?? '') : robot.parts.get(job.part);
      if (!at || !robot.groups[at.group]) continue;
      const pose = host.pose(robot, at);
      const c = cos(pose.angle);
      const s = sin(pose.angle);
      const cells = (job.placed ? placedCells(host.registry, job.placed) : cellsOf(at)).map((cell) => {
        const dx = cell.x - at.x;
        const dy = cell.y - at.y;
        return { x: pose.x + c * dx - s * dy, y: pose.y + s * dx + c * dy };
      });
      out.push({ robot: robot.id, kind: job.kind, part: job.part, body: robot.groups[at.group]?.bodyId as number, cells, angle: pose.angle, done: job.ticks > 0 ? 1 - job.left / job.ticks : at.health / at.def.health });
    }
  }
  return out;
}

/** What repair adds to the state hash. A robot that never got an order through adds nothing. */
export function hashRepairs(h: StateHasher, robots: readonly Robot[]): void {
  for (const robot of robots) {
    const r = robot.repair;
    if (!r) continue;
    h.addString('repair');
    h.addInt(robot.id);
    h.addF64(r.tank);
    h.addInt(r.jobs.length);
    for (const j of r.jobs) {
      h.addString(j.kind);
      h.addString(j.part);
      h.addInt(j.left);
      h.addF64(j.paid);
      h.addF64(j.to);
    }
  }
}
