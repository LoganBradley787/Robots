import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type BodyId, type ShapeSpec } from '../physics/PhysicsWorld';
import { Prng } from '../rng/Prng';
import { StateHasher } from '../replay/StateHasher';
import { InputLog, type WorldChange } from '../replay/InputLog';
import { Controller } from '../control/controller';
import type { ControlledPart, RobotInput } from '../control/types';
import { BEHAVIORS, type BehaviorContext } from '../behaviors/registry';
import { allBindings, autoBindings } from '../control/autoControls';
import { drainContainers, fillContainers, grantFactor, poolTotals, type Container } from '../resources/pools';
import type { PlannedAction } from '../behaviors/registry';
import { ScriptRunner } from '../script/runner';
import type { ScannedPart, ScriptContact, ScriptError, ScriptHost, ScriptInput, ScriptMark, ScriptServices } from '../script/types';
import { contactHead, contactJson, contactMiddle, extrasJson, HEADER, layoutJson, layoutPatch, numberCount, put, SELF, type LayoutPart, type ScriptFrame, type ScriptLayout } from '../script/frame';
import { sees, type SensorPose } from '../sensors/sight';
import { jammed, type JamBubble } from '../sensors/jam';
import { SMOKE_DRIFT, type SmokeCloud } from '../sensors/smoke';
import type { TerrainBox } from '../physics/PhysicsWorld';
import { partWorldPose } from '../metrics/robotMetrics';
import { crashFraction, crashWeight } from './crash';
import { buildWorld, type WorldFile } from './WorldFile';
import { defaultRegistry, type PartRegistry } from '../parts/registry';
import { loadBlueprint, validateBlueprint } from '../blueprint/validate';
import { spawnRobot } from '../assembly/spawn';
import { partCells, rootPartId } from '../assembly/assemble';
import { placeBlueprint } from '../blueprint/place';
import { buildSeconds, hollowAt, recipePlacement, recipeStats, scopeBase } from '../fabricate/recipe';
import { footprintOf, partMass } from '../parts/footprint';
import { rebuildRobot, type BodyMotion } from '../assembly/rebuild';
import { blastEffects, type BlastCell } from '../damage/explosion';
import { faceDir, opposite, rotateCell, rotateFace } from '../parts/faces';
import type { ExplodeSpec, Face, JammerSpec } from '../parts/types';
import type { PartInstance, Robot } from './Robot';
import { BAY_CLEAR_SPEED, bayClearAfterTicks } from './bayclear';
import { DEBRIS_REST_SECONDS, sweepDebris } from './debris';
import { SIGHT, type GunSight, type Shell } from '../weapons/shells';
import type { Binding, Blueprint, CoreControls, ScriptSpec } from '../blueprint/types';
import { scopedView } from '../control/target';
import { Grapples, type GrappleHost } from './grapple';

export interface SpawnRecord {
  tick: number;
  name: string;
  at: { x: number; y: number };
  /** The raw blueprint as passed in. */
  blueprint: unknown;
  /** The robot's team (M8). Absent in replays made before teams, which means 0. */
  team?: number;
}

export interface SpawnOptions {
  /** 0 (the player's side, the default) or another team number. */
  team?: number;
}

/** Something that happened in the sim, for the UI and reports. Not part of the state hash. */
export type WorldEvent =
  | {
      tick: number;
      robot: number;
      kind: 'energyEmpty';
      /** Index of the chunk whose pool ran dry. */
      chunk: number;
    }
  | { tick: number; robot: number; kind: 'scriptCrashed'; script: string; error: ScriptError }
  /** A part reached 0 health and is gone. `x`, `y` is where its cell was; `exploded` when it set off a blast (M10). */
  | { tick: number; robot: number; kind: 'partDestroyed'; part: string; partType: string; x: number; y: number; exploded: boolean; burntOut?: true }
  /** A blast went off (`robot` owned the part that exploded). */
  | { tick: number; robot: number; kind: 'explosion'; x: number; y: number; radius: number }
  /** A robot broke apart: it keeps one piece, the others are new robots. */
  | { tick: number; robot: number; kind: 'split'; pieces: number[] }
  /** A decoupler fired; `x`, `y` is the middle of its release face. */
  | { tick: number; robot: number; kind: 'decoupled'; part: string; x: number; y: number }
  /** A robot's active core was destroyed: nobody controls it any more and it keeps its last input. */
  | { tick: number; robot: number; kind: 'coreLost' }
  /** A piece broke off with exactly one core, which woke up and can be controlled. */
  | { tick: number; robot: number; kind: 'coreWoke'; from: number }
  /** A robot is gone: all its parts were destroyed, or Clear debris took it. */
  | { tick: number; robot: number; kind: 'removed' }
  /** A script sent a message to an attached core (M8); `data` is its JSON text. */
  | { tick: number; robot: number; kind: 'sent'; to: string; data: string }
  /** M10: a part that needs arming was armed by its `arm` input (a key or a script). */
  | { tick: number; robot: number; kind: 'armed'; part: string }
  /** M11: a decoy (a flare) was lit by its `ignite` input; `of` is the robot it stands in for while it burns. */
  | { tick: number; robot: number; kind: 'lit'; part: string; of: number }
  /** M11: a decoy burnt out; it is destroyed this tick without a blast. */
  | { tick: number; robot: number; kind: 'burntOut'; part: string }
  /** Batch: a jammer pod started jamming, in a bubble of `radius` meters around `x`, `y`. */
  | { tick: number; robot: number; kind: 'jamStarted'; part: string; x: number; y: number; radius: number }
  /** M12: a fabricator finished a copy of `recipe`, now held in it with its own `scope`. */
  | { tick: number; robot: number; kind: 'built'; part: string; recipe: string; scope: string }
  /** M12: a fabricator let go of what it held. */
  | { tick: number; robot: number; kind: 'released'; part: string; scope: string }
  /** M12: a fabricator finished a build but cannot place it yet (`why`); it tries every tick. Once per wait. */
  | { tick: number; robot: number; kind: 'buildBlocked'; part: string; why: string }
  /** Batch: a grapple's hook caught something (`to` is the robot it caught, 0 for the ground or a loose body) and tied a rope of `length` meters. */
  | { tick: number; robot: number; kind: 'hooked'; part: string; to: number; length: number }
  /** Batch: a grapple's rope is gone: released on purpose, or lost (either end's part was destroyed). */
  | { tick: number; robot: number; kind: 'unhooked'; part: string; why: 'released' | 'lost' }
  /** M13: a shell from robot `by` hit `part` of `robot` at `x`, `y`, taking `damage` off it. */
  | { tick: number; robot: number; kind: 'shellHit'; part: string; partType: string; by: number; x: number; y: number; damage: number }
  /** Batch: a smoke pod went off, leaving a cloud of `radius` meters at `x`, `y`; the pod is gone. */
  | { tick: number; robot: number; kind: 'smoked'; part: string; x: number; y: number; radius: number };

/** The world center of each footprint cell of a part, from its origin cell's pose (M12, multi-cell parts). */
function footprintPoses(origin: { x: number; y: number; angle: number }, part: PartInstance): BlastCell[] {
  const c = Math.cos(origin.angle);
  const s = Math.sin(origin.angle);
  return (part.footprint ?? part.def.footprint).map((fc) => {
    const o = rotateCell(fc, part.rot);
    return { x: origin.x + c * o.x - s * o.y, y: origin.y + s * o.x + c * o.y, angle: origin.angle };
  });
}

/** A box around a body's part cells, in the body's own frame (meters from its origin cell). */
interface HullBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** See `World.hull`. */
interface Hull {
  standIns: boolean;
  /** By body group index; undefined for a group with no parts. */
  boxes: (HullBox | undefined)[];
  body: (group: number) => BodyPose;
}

/** Added to a charge's radius for the box check only, so rounding can never hide a cell the exact check would find. */
const CHARGE_SLACK = 0.01;

function growBox(box: HullBox, x: number, y: number): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

/** Whether the point is inside the box grown by `reach` on every side. Outside it, no cell in the box is within `reach` of the point. */
function nearBox(box: HullBox, body: BodyPose, at: { x: number; y: number }, reach: number): boolean {
  const dx = at.x - body.s.x;
  const dy = at.y - body.s.y;
  const lx = body.c * dx + body.n * dy;
  const ly = body.c * dy - body.n * dx;
  return lx >= box.minX - reach && lx <= box.maxX + reach && ly >= box.minY - reach && ly <= box.maxY + reach;
}

/** A burning decoy as a sensor sees it (M11): where it is, which piece holds it, and how it moves. */
const NO_DECOYS: readonly SeenDecoy[] = [];

interface SeenDecoy {
  robot: Robot;
  partId: string;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
}

/**
 * M13: the fastest anything is taken to close on a shell, m/s. Each tick a shell also looks this far (times dt) behind
 * where it was, for a body that came at it through that stretch during the tick: the ray is cast against where bodies
 * are at the end of the tick, so without it a missile closing at 130 m/s let about one shell in six through its nose.
 */
const SHELL_SWEEP = 600;

/** Blasts resolved per tick at most (`03`); the rest wait for the next tick. */
export const MAX_BLASTS_PER_TICK = 100;

/** Messages a robot's scripts may send per tick, all together (M8 review). */
export const SENDS_PER_TICK = 64;

interface QueuedBlast {
  robot: number;
  x: number;
  y: number;
  spec: ExplodeSpec;
}

/** One `log()` line from a script. */
export interface ScriptLog {
  tick: number;
  robot: number;
  script: string;
  text: string;
}

/** Log lines kept, oldest dropped first, and lines a robot may log per second. */
const LOG_KEEP = 200;
const LOG_PER_SECOND = 20;

export interface WorldOptions {
  seed: number;
  /** Runs robots' scripts. Without one, a robot's scripts report that they cannot run. */
  scripts?: ScriptHost;
  dt?: number;
  gravityY?: number;
  /**
   * Tests only (M9 parity): called before a robot's scripts run with the input the old JSON path would have built,
   * so a test can compare it with what the scripts actually see. Costs a full old-style input per call.
   */
  scriptProbe?: (robotId: number, reference: () => ScriptInput) => void;
  /**
   * Tests only: every rebuild works a robot's pieces out from scratch, never from what it kept of its last rebuild
   * (`assembly/rebuild.ts`). The outcome must be the same either way; a test runs both and compares.
   */
  fullRebuild?: boolean;
  /**
   * Tests only: a changed robot's scripts are handed its whole parts layout again, never a patch on the one they hold
   * (`script/frame.ts`, `layoutPatch`). What a script sees must be the same either way; a test runs both and compares.
   */
  fullLayouts?: boolean;
}

/** A body's state with the cosine and sine of its angle, read once per tick for all its parts. */
interface BodyPose {
  s: { x: number; y: number; angle: number; vx: number; vy: number; w: number };
  c: number;
  n: number;
}

/** A robot's script layout (M9, `script/frame.ts`), kept until the robot changes. */
interface ScriptFeed {
  /** `Robot.version` and the core the scripts run on. */
  key: string;
  /** The chunk the scripts see (the core's), and the robot's mass: both fixed until the robot is rebuilt. */
  chunk: number;
  mass: number;
  layout: ScriptLayout;
  /** The layout's entries, kept so the next layout can be handed over as a patch on this one. */
  rows: LayoutPart[];
  parts: { id: string; part: PartInstance; in: readonly string[]; out: readonly string[] }[];
  numbers: Float64Array;
}

/** Where a robot is for sensors, whoever looks (`World.reference`). */
interface Reference {
  core: boolean;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  center: { x: number; y: number };
  mass: number;
}

/** A working radio part in world space (Batch). */
interface RadioPose {
  x: number;
  y: number;
  range: number;
}

/** What a robot's own sensors see: whether any works, its contacts nearest first, and those seen at a decoy. */
interface OwnSight {
  sensors: boolean;
  contacts: ScriptContact[];
  fooled?: Map<number, SeenDecoy>;
}

/**
 * What the sensor pass works out about a robot whoever is looking, kept while one tick's scripts run so every viewer,
 * every radio listener, and every script scanning it pays once. Nothing in it changes while scripts run: they only
 * write channel values and messages. Derived, never hashed; outside `shareSight` there is none and every question is
 * answered afresh.
 */
interface SightPass {
  refs: Map<Robot, Reference>;
  sensors: Map<Robot, SensorPose[]>;
  radios: Map<Robot, RadioPose[]>;
  own: Map<Robot, OwnSight>;
  /** Each robot's parts as `scan()` lists them, and the same as JSON text once a script asked for it. */
  scans: Map<Robot, ScannedPart[]>;
  scanTexts: Map<ScannedPart[], string>;
  /** The JSON text of each contact up to its distance (`contactHead`), and per seen robot the part every viewer shares. */
  heads: Map<ScriptContact, string>;
  middles: Map<Robot, string>;
  /** Per team, what its radio robots have to tell (`World.teamReports`). */
  reports: Map<number, Map<number, Report[]>>;
}

/** One teammate's report of a robot it sees itself, for the radio. */
interface Report {
  friend: Robot;
  /** The friend's place among the robots, and the contact's place in its list: the order a plain walk meets them. */
  order: number;
  index: number;
  contact: ScriptContact;
  decoy: SeenDecoy | undefined;
}

export class World {
  readonly dt: number;
  readonly seed: number;
  readonly rng: Prng;
  readonly physics: PhysicsWorld;
  readonly inputLog = new InputLog();
  readonly file: WorldFile;
  readonly registry: PartRegistry;
  /** Spawned robots in spawn order. Render and UI read these; only the sim mutates them. */
  readonly robots: Robot[] = [];
  /** Every spawn, in order, so a replay can reproduce them. Not part of the state hash. */
  readonly spawnLog: SpawnRecord[] = [];
  private tickCount = 0;
  private nextRobotId = 1;
  /** One controller per robot with a primary core, keyed by robot id. */
  private readonly controllers = new Map<number, Controller>();
  /** Sandbox switch: every energy request is granted and nothing drains. Simulation state, logged and hashed. */
  private unlimited = false;
  private pendingUnlimited: boolean | undefined;
  /** Events so far, oldest first. Readers keep their own cursor. */
  readonly events: WorldEvent[] = [];
  private readonly scriptHost: ScriptHost | undefined;
  private readonly scriptProbe?: (robotId: number, reference: () => ScriptInput) => void;
  private readonly fullRebuild: boolean;
  private readonly fullLayouts: boolean;
  private readonly feeds = new WeakMap<Robot, ScriptFeed>();
  /** Every robot in `robots`, by id (M9: lookups on every tick without scanning the list). */
  private readonly byId = new Map<number, Robot>();
  private layouts = 0;
  /** Scripts per robot, on robots with a core. */
  private readonly runners = new Map<number, ScriptRunner>();
  /** Recent `log()` lines from scripts, oldest first (at most LOG_KEEP). */
  readonly scriptLogs: ScriptLog[] = [];
  /** Log lines per robot in the current second, for rate limiting. */
  private readonly logBudget = new Map<number, { second: number; count: number }>();
  /** Pools that have already reported running dry, by `robot:chunk`. */
  private readonly emptied = new Set<string>();
  /** Batch: consecutive resting ticks of each broken-off coreless piece (only pieces that have rested at all). */
  private readonly debrisRest = new Map<number, number>();
  /** Energy drawn so far, per robot. Reporting only. */
  private readonly used = new Map<number, number>();
  /**
   * Final channel values from the last tick, per robot, for behaviors, render, and UI. A robot nobody can control
   * (headless, or a piece that broke off) keeps its values frozen here: that is latching (`04`).
   */
  private readonly channels = new Map<number, Map<string, Map<string, number>>>();
  private pendingClearDebris = false;
  /** Robots whose parts or faces changed this tick and must be rebuilt in the damage phase. */
  private readonly dirty = new Set<Robot>();
  /**
   * Rebuilds so far, by how the robot's pieces were found (`assembly/rebuild.ts`): `whole` for a robot that only lost
   * parts and stayed as it was, `assembled` for one worked out from scratch. Reporting only, not hashed.
   */
  readonly rebuilds = { whole: 0, assembled: 0 };
  /** Blasts waiting because the per-tick cap was reached. Simulation state, hashed. */
  private queuedBlasts: QueuedBlast[] = [];
  /**
   * Pushes (N s) waiting for the next physics step, by part: they land on whatever body holds the part by then, so a
   * robot rebuilt again before the step keeps them. Simulation state, hashed.
   */
  private pendingPushes: { part: PartInstance; jx: number; jy: number; quiet?: true }[] = [];
  /** M13: shells in flight, oldest first. Simulation state, hashed. */
  private shells: Shell[] = [];
  /** Shells that hit on the last tick, for drawing only. Not hashed. */
  private spent: Shell[] = [];
  /** Batch: smoke clouds, oldest first. They block sensors' line of sight. Simulation state, hashed only while any exist. */
  private clouds: SmokeCloud[] = [];
  /** M13: robots that grew parts this tick, whose new guns get their aim before scripts next run. Derived. */
  private readonly unprimed = new Set<Robot>();
  /** Batch: grapple ropes and held triggers. Simulation state, hashed when present. */
  private readonly grapples = new Grapples();
  private grappleHost?: GrappleHost;
  /** M13: shells each robot's guns have fired. Reporting only. */
  private readonly shots = new Map<number, number>();
  /**
   * Velocities for new bodies, applied as kicks just before the next physics step. Until then Rapier reports them at
   * rest, so a second rebuild reads the velocity from here (M6 review). Simulation state, hashed.
   */
  private readonly pendingKicks = new Map<BodyId, { vx: number; vy: number; w: number }>();
  /**
   * Kicks given on this tick's step. A kicked multibody link moves at part speed during that step and reports about
   * 88% after it, yet it is at the full target (it moves at exactly that speed on the next step), so until it has been
   * stepped twice the target is its velocity. Cleared when the next kicks go in. Derived from hashed state.
   */
  private lastKicks = new Map<BodyId, { vx: number; vy: number; w: number }>();
  /**
   * Bodies whose velocity jumps for a reason other than a hit (a kick after a rebuild, a blast push), by the last tick
   * the impact check ignores them. Not hashed: it is derived from what happened on recent ticks.
   */
  private readonly unsettled = new Map<BodyId, number>();
  private readonly gravityY: number;
  /** Sends per robot on the current tick (derived from this tick only, so not hashed). */
  private sendsThisTick: { tick: number; counts: Map<number, number> } = { tick: -1, counts: new Map() };
  /** When each sender and receiver pair last got a `sent` event. Reporting only. */
  private readonly lastSentEvent = new Map<string, number>();
  /** Fixed terrain boxes, read once: they never change after the world is built. */
  private terrain: TerrainBox[] | undefined;
  /**
   * Decoys lit at some point and maybe still burning (M11), so contacts skip looking for decoys when there are none.
   * Pruned when the world is scanned for burning decoys. Derived from hashed state (each part's `burn`).
   */
  private readonly decoys = new Set<PartInstance>();
  /** Fabricators waiting on a finished build, told once (M12). Reporting only, not hashed. */
  private readonly stuck = new WeakSet<PartInstance>();
  /**
   * Batch: the tick a bay first found a piece with no core in its hollow, while it is still there. After a second the
   * bay pushes it out. Simulation state, hashed only while any is set.
   */
  private readonly clearing = new WeakMap<PartInstance, number>();
  /** Robots that grew parts this tick (M12: a fabricator finished): their controller is rebuilt with the rebuild. */
  private readonly grown = new Set<Robot>();
  /** Each robot blueprint's fabricator jobs by part (M12), worked out once per blueprint object. Derived. */
  private readonly jobs = new WeakMap<Blueprint, Map<string, { seconds: number; joules: number } | undefined>>();
  /** Batch: jamming bubbles for the tick they were found on. Derived; dropped when robots come or go. */
  private jamCache: { tick: number; bubbles: JamBubble[] | undefined } | undefined;
  /** Batch: jammer pods lit at some point and maybe still jamming, so sensors skip looking for bubbles when there are none. Derived from each part's `burn`. */
  private readonly jammers = new Set<PartInstance>();
  /** Burning decoys as sensors see them, for the tick they were found on (M11). Derived; dropped when robots come or go. */
  private decoyCache: { tick: number; view: { of: Map<number, SeenDecoy[]>; pieces: Set<number> } | undefined } | undefined;
  /** Contacts each robot's sensors saw at a decoy when its scripts last ran, for `scan()` (M11). Derived, not hashed. */
  private readonly seenDecoys = new Map<number, Map<number, SeenDecoy>>();
  /** Robots each robot's sensors saw when its scripts last ran (its own contacts), for `scan()` (M8). Derived, not hashed. */
  private readonly seen = new Map<number, readonly ScriptContact[]>();
  /** The sensor pass's shared answers while this tick's scripts run (`shareSight`); undefined at any other time. */
  private pass: SightPass | undefined;
  /** The marks each robot's scripts made when they last ran, by script (M8). For the overlay and reports; not hashed. */
  private readonly scriptMarks = new Map<number, { script: string; marks: ScriptMark[] }[]>();

  private constructor(opts: WorldOptions, file: WorldFile, registry: PartRegistry) {
    this.registry = registry;
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.scriptHost = opts.scripts;
    if (opts.scriptProbe) this.scriptProbe = opts.scriptProbe;
    this.fullRebuild = opts.fullRebuild === true;
    this.fullLayouts = opts.fullLayouts === true;
    this.rng = new Prng(opts.seed);
    this.gravityY = opts.gravityY ?? -9.81;
    this.physics = new PhysicsWorld(this.gravityY, this.dt);
    this.file = file;
    buildWorld(this.physics, file);
  }

  /** The only way to make a World: guarantees the Rapier WASM is loaded first. */
  static async create(opts: WorldOptions, file: WorldFile, registry: PartRegistry = defaultRegistry()): Promise<World> {
    await loadRapier();
    return new World(opts, file, registry);
  }

  get tick(): number {
    return this.tickCount;
  }

  get time(): number {
    return this.tickCount * this.dt;
  }

  /**
   * Validates and spawns a blueprint with its primary core (or first part) at `at`.
   * Throws BlueprintError, before creating any body, when the blueprint has errors.
   */
  spawnBlueprint(raw: unknown, at: { x: number; y: number }, opts: SpawnOptions = {}): Robot {
    const team = opts.team ?? 0;
    if (!Number.isInteger(team) || team < 0) throw new Error(`team must be a whole number, 0 or more, got ${String(team)}`);
    const { blueprint, plan } = loadBlueprint(raw, this.registry);
    const robot = spawnRobot(this.physics, this.registry, blueprint, plan, { id: this.nextRobotId++, tick: this.tickCount, at, team });
    this.robots.push(robot);
    this.byId.set(robot.id, robot);
    this.decoyCache = undefined;
    this.jamCache = undefined;
    const controller = controllerFor(robot, this.registry);
    if (controller) {
      this.controllers.set(robot.id, controller);
      this.channels.set(robot.id, controller.values());
      this.startScripts(robot, robot.blueprint.scripts);
    }
    this.primeSights(robot);
    this.spawnLog.push({ tick: this.tickCount, name: robot.name, at: { x: at.x, y: at.y }, blueprint: raw, ...(team !== 0 ? { team } : {}) });
    return robot;
  }

  /**
   * Whether the blueprint could be spawned at `at` right now: it must validate and none of its colliders may overlap
   * anything already in the world, terrain included. Parts are checked with the shapes they spawn with.
   */
  canPlace(raw: unknown, at: { x: number; y: number }): { ok: boolean; reason?: string } {
    const v = validateBlueprint(raw, this.registry);
    if (!v.ok || !v.blueprint) {
      const first = v.issues.find((i) => i.severity === 'error');
      return { ok: false, reason: first?.message ?? 'blueprint is invalid' };
    }
    const bp = v.blueprint;
    const root = bp.parts.find((p) => p.id === rootPartId(bp, this.registry));
    if (!root) return { ok: false, reason: 'blueprint has no parts' };
    const shapes = bp.parts.flatMap((p) => {
      const collider = this.registry.get(p.part).collider;
      const shape: ShapeSpec = collider?.shape === 'ball' ? { shape: 'ball', radius: collider.radius ?? 0.5 } : { shape: 'box', hx: 0.5, hy: 0.5 };
      return partCells(p, this.registry).map(({ cell }) => ({ x: at.x + cell.x - root.x, y: at.y + cell.y - root.y, shape }));
    });
    // The ground surface is y = 0. Below it is solid earth to the player even where the physics slab ends.
    const lowest = Math.min(...shapes.map((s) => s.y - (s.shape.shape === 'box' ? s.shape.hy : s.shape.radius)));
    if (lowest < -0.02) return { ok: false, reason: 'below the ground' };
    return this.physics.overlapsShapes(shapes) ? { ok: false, reason: 'overlaps something already in the world' } : { ok: true };
  }

  /**
   * Advances one tick: applies key edges to their robots' controllers, computes channel values, runs behaviors,
   * steps physics, then resolves damage (`03`: destroyed parts, blasts, splits). Robots without inputs keep their
   * held keys and toggles. An input for a robot that can no longer be controlled (its core was destroyed, or it was
   * cleared) is dropped unlogged, since the caller could not know yet; one for a robot that never existed throws.
   */
  step(inputs: readonly RobotInput[] = []): void {
    for (const input of inputs) {
      if (!Number.isInteger(input.robot) || input.robot < 1 || input.robot >= this.nextRobotId) throw new Error(`robot ${input.robot} does not exist`);
    }
    const accepted = inputs.filter((i) => this.controllers.has(i.robot));
    this.decoyCache = undefined;
    this.jamCache = undefined;
    const change: WorldChange = {};
    if (this.pendingUnlimited !== undefined) change.unlimitedEnergy = this.pendingUnlimited;
    if (this.pendingClearDebris) change.clearDebris = true;
    if (this.pendingUnlimited !== undefined) this.unlimited = this.pendingUnlimited;
    this.pendingUnlimited = undefined;
    if (this.pendingClearDebris) this.removeDebris();
    this.pendingClearDebris = false;
    this.inputLog.append(this.tickCount, accepted, Object.keys(change).length > 0 ? change : undefined);
    for (const input of accepted) this.controllers.get(input.robot)?.apply(input.pressed, input.released);
    for (const robot of this.unprimed) this.primeSights(robot);
    this.unprimed.clear();
    this.runScripts();
    for (const [id, c] of this.controllers) this.channels.set(id, c.values());
    this.armParts();
    this.runSolar();
    // Structure first (a decoupler firing), so the pieces exist before anything pushes on this tick.
    this.runBehaviors(true);
    if (this.dirty.size > 0) this.rebuildDirty();
    this.runBehaviors(false);
    this.applyPendingForces();
    this.grapples.sync(this.gh());
    this.physics.step();
    this.runGuns();
    this.grapples.run(this.gh());
    this.damagePhase();
    this.fadeDebris();
    for (const c of this.controllers.values()) c.endTick();
    this.tickCount++;
  }

  /**
   * M10: a part that needs arming (`arming` in its def) is armed for good once its `arm` input is above 0.5, before
   * behaviors run, so arming and `detonate` on the same tick go off.
   * M11: a decoy is lit for good once its `ignite` input is above 0.5, before behaviors run, so a decoupler letting
   * it go on the same tick lets it go burning, standing in for the robot it was part of. A lit decoy burns down one
   * tick at a time and is destroyed (quietly: a decoy has no blast) when it reaches 0.
   */
  private armParts(): void {
    this.driftSmoke();
    for (const robot of this.robots) {
      const chans = this.channels.get(robot.id);
      for (const part of robot.parts.values()) {
        if (part.def.smoke !== undefined) this.releaseSmoke(robot, part, chans?.get(part.id)?.get('on') ?? 0, part.def.smoke);
        if (part.def.decoy !== undefined) this.burnDecoy(robot, part, chans?.get(part.id)?.get('ignite') ?? 0, part.def.decoy.burn);
        if (part.def.jammer !== undefined) this.burnJammer(robot, part, chans?.get(part.id)?.get('ignite') ?? 0, part.def.jammer);
        if (part.armed !== false || (chans?.get(part.id)?.get('arm') ?? 0) <= 0.5) continue;
        part.armed = true;
        this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'armed', part: part.id });
      }
    }
  }

  /**
   * Batch: every solar panel adds its power times the cosine of the angle between its `acts` face and straight up
   * (nothing when it points level or down) to its chunk's energy pool, filling the containers up to capacity. A chunk's
   * panels are added up first, then poured in once, so the result never depends on part order. Runs before behaviors,
   * so a part can spend on the tick what the sun gave it. Panels in the sandbox's unlimited-energy mode make nothing.
   */
  private runSolar(): void {
    if (this.unlimited) return;
    for (const robot of this.robots) {
      let sums: Map<number, number> | undefined;
      for (const part of robot.parts.values()) {
        const spec = part.def.solar;
        if (spec === undefined || part.health <= 0) continue;
        const up = this.muzzle(robot, part)?.dy ?? 0;
        if (up <= 0) continue;
        sums ??= new Map();
        const chunk = chunkIndex(robot, part.id);
        sums.set(chunk, (sums.get(chunk) ?? 0) + spec.power * up * this.dt);
      }
      if (!sums) continue;
      for (const [chunk, amount] of sums) {
        const containers = poolContainers(robot, chunk);
        if (fillContainers(containers, amount) <= 0) continue;
        for (const c of containers) {
          const held = robot.parts.get(c.id);
          if (held) held.stored = c.stored;
        }
      }
    }
  }

  /**
   * Batch: a smoke pod whose `on` input is above 0.5 releases its cloud where it is and is used up (health 0, so it
   * goes in the damage phase without a blast). The cloud stays where it was released, sinking slowly.
   */
  private releaseSmoke(robot: Robot, part: PartInstance, on: number, spec: { radius: number; seconds: number }): void {
    if (on <= 0.5 || part.health <= 0) return;
    const pose = partWorldPose(this, robot, part.id);
    const total = Math.max(1, Math.round(spec.seconds / this.dt));
    this.clouds.push({ x: pose.x, y: pose.y, radius: spec.radius, left: total, total });
    part.health = 0;
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'smoked', part: part.id, x: pose.x, y: pose.y, radius: spec.radius });
  }

  /** Batch: every cloud sinks a little and ages one tick; a spent one is gone. */
  private driftSmoke(): void {
    if (this.clouds.length === 0) return;
    for (const c of this.clouds) {
      c.left--;
      c.y -= SMOKE_DRIFT * this.dt;
    }
    this.clouds = this.clouds.filter((c) => c.left > 0);
  }

  /** Batch: smoke clouds now, oldest first, for drawing. Read only. */
  smokeClouds(): readonly SmokeCloud[] {
    return this.clouds;
  }

  private burnDecoy(robot: Robot, part: PartInstance, ignite: number, seconds: number): void {
    if (part.burn === undefined) {
      if (ignite <= 0.5 || part.health <= 0) return;
      part.burn = Math.max(1, Math.round(seconds / this.dt));
      part.decoyOf = robot.id;
      this.decoys.add(part);
      this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'lit', part: part.id, of: robot.id });
      return;
    }
    if (part.burn <= 0) return;
    part.burn--;
    if (part.burn > 0) return;
    part.health = 0;
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'burntOut', part: part.id });
  }

  /**
   * Batch: a jammer pod is lit for good once its `ignite` input is above 0.5 (same rule as a decoy), jams `seconds`
   * (its `burn` counts the ticks down), and is destroyed quietly when it reaches 0.
   */
  private burnJammer(robot: Robot, part: PartInstance, ignite: number, spec: JammerSpec): void {
    if (part.burn === undefined) {
      if (ignite <= 0.5 || part.health <= 0) return;
      part.burn = Math.max(1, Math.round(spec.seconds / this.dt));
      this.jammers.add(part);
      this.jamCache = undefined;
      const pose = partWorldPose(this, robot, part.id);
      this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'jamStarted', part: part.id, x: pose.x, y: pose.y, radius: spec.radius });
      return;
    }
    if (part.burn <= 0) return;
    part.burn--;
    if (part.burn > 0) return;
    part.health = 0;
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'burntOut', part: part.id });
  }

  /**
   * Batch: every bubble now, one per jamming pod, where the pod is. Undefined when none jams (the usual case costs
   * nothing). Computed once per tick.
   */
  private jamBubbles(): JamBubble[] | undefined {
    if (this.jammers.size === 0) return undefined;
    if (this.jamCache?.tick === this.tickCount) return this.jamCache.bubbles;
    const out: JamBubble[] = [];
    this.jammers.clear();
    for (const r of this.robots) {
      for (const bp of r.blueprint.parts) {
        const part = r.parts.get(bp.id);
        const spec = part?.def.jammer;
        if (!part || !spec || (part.burn ?? 0) <= 0 || !r.groups[part.group]) continue;
        this.jammers.add(part);
        const pose = partWorldPose(this, r, part.id);
        out.push({ x: pose.x, y: pose.y, radius: spec.radius });
      }
    }
    const bubbles = out.length === 0 ? undefined : out;
    this.jamCache = { tick: this.tickCount, bubbles };
    return bubbles;
  }

  /**
   * Batch: gives every body of a robot a velocity as a kick on the next step, like the ones a rebuild gives new pieces
   * (the impact check ignores it). For tests and tools; a raw physics kick reads as a crash.
   */
  kickRobot(robot: Robot, vx: number, vy: number, w = 0): void {
    for (const g of robot.groups) this.pendingKicks.set(g.bodyId, { vx, vy, w });
  }

  /** Removes every robot nobody can control (debris, headless robots, bombs) on the next tick, logged for replays. */
  clearDebris(): void {
    this.pendingClearDebris = true;
  }

  private removeDebris(): void {
    for (const robot of [...this.robots]) if (!this.controllers.has(robot.id)) this.removeRobot(robot);
  }

  /** Batch: broken-off coreless pieces that rest for 10 s fade away, and past 200 the oldest go (see debris.ts). */
  private fadeDebris(): void {
    const gone = sweepDebris(this.physics, this.robots, this.debrisRest, Math.max(1, Math.round(DEBRIS_REST_SECONDS / this.dt)));
    for (const robot of gone) this.removeRobot(robot);
  }

  private removeRobot(robot: Robot): void {
    this.debrisRest.delete(robot.id);
    for (const g of robot.groups) {
      this.pendingKicks.delete(g.bodyId);
      this.lastKicks.delete(g.bodyId);
      this.physics.removeBody(g.bodyId);
    }
    robot.groups = [];
    const i = this.robots.indexOf(robot);
    if (i >= 0) this.robots.splice(i, 1);
    this.byId.delete(robot.id);
    this.controllers.delete(robot.id);
    this.channels.delete(robot.id);
    this.runners.get(robot.id)?.dispose();
    this.runners.delete(robot.id);
    this.dirty.delete(robot);
    this.grown.delete(robot);
    this.used.delete(robot.id);
    this.logBudget.delete(robot.id);
    this.seen.delete(robot.id);
    this.seenDecoys.delete(robot.id);
    this.decoyCache = undefined;
    this.jamCache = undefined;
    this.scriptMarks.delete(robot.id);
    for (const key of [...this.emptied]) if (key.startsWith(`${robot.id}:`)) this.emptied.delete(key);
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'removed' });
  }

  /**
   * The damage phase (`03`, Cell removal pipeline), after the physics step: hard hits break parts with `impact`,
   * destroyed parts go (and explode if they do), changed robots are rebuilt and split, then blasts damage and push
   * parts, which can destroy more; repeat until nothing is left or the blast cap is reached. Pushes and the kicks
   * that give new bodies their velocity act on the next step.
   */
  private damagePhase(): void {
    this.checkCharges();
    this.checkImpacts();
    let budget = MAX_BLASTS_PER_TICK;
    for (;;) {
      this.destroyDeadParts();
      this.rebuildDirty();
      if (this.queuedBlasts.length === 0 || budget === 0) break;
      const batch = this.queuedBlasts.splice(0, budget);
      budget -= batch.length;
      for (const b of batch) this.applyBlast(b);
    }
  }

  /**
   * Parts with `impact` (a warhead's fuze) break when a hit changes their body's velocity by more than `impact.speed`
   * in one step, gravity aside. Measured from the velocity, not Rapier's contact forces, which are not reported for
   * contacts on multibody links (a bomb bouncing off a car's roof went unnoticed). Thrust changes a body's speed by a
   * fraction of a meter per second per step, so only hits count.
   *
   * Batch: every other part takes crash damage from the same measure (`crash` on its def, default safe 8 m/s): see
   * `world/crash.ts`. Bodies in `unsettled` (kicks, blast pushes) never count.
   */
  private checkImpacts(): void {
    for (const [body, until] of this.unsettled) if (until < this.tickCount) this.unsettled.delete(body);
    for (const robot of this.robots) {
      // Each body's velocity change this step (gravity aside), read once: undefined for a body that was just kicked.
      const hits = new Map<number, { dv: number; ux: number; uy: number } | undefined>();
      const hitOf = (index: number): { dv: number; ux: number; uy: number } | undefined => {
        if (hits.has(index)) return hits.get(index);
        const group = robot.groups[index];
        let hit: { dv: number; ux: number; uy: number } | undefined;
        if (group && !this.unsettled.has(group.bodyId)) {
          const s = this.physics.state(group.bodyId);
          const p = this.physics.prevState(group.bodyId);
          const dvx = s.vx - p.vx;
          const dvy = s.vy - p.vy - this.gravityY * this.dt;
          const dv = Math.sqrt(dvx * dvx + dvy * dvy);
          // The impact is on the side the velocity change points away from.
          hit = { dv, ux: dv > 0 ? -dvx / dv : 0, uy: dv > 0 ? -dvy / dv : 0 };
        }
        hits.set(index, hit);
        return hit;
      };
      // Batch: crash damage, spread over the robot by how near each part is to the impact (`world/crash.ts`).
      let poses: Map<string, { x: number; y: number }> | undefined;
      const poseOf = (id: string): { x: number; y: number } => {
        if (!poses) {
          poses = new Map();
          for (const other of robot.parts.values()) poses.set(other.id, partWorldPose(this, robot, other.id));
        }
        return poses.get(id) ?? { x: 0, y: 0 };
      };
      const spreads = new Map<number, { cx: number; cy: number; reach: number }>();
      const spreadOf = (index: number, hit: { ux: number; uy: number }): { cx: number; cy: number; reach: number } => {
        const known = spreads.get(index);
        if (known) return known;
        poseOf('');
        let cx = 0;
        let cy = 0;
        for (const q of poses?.values() ?? []) {
          cx += q.x;
          cy += q.y;
        }
        const n = Math.max(1, poses?.size ?? 1);
        cx /= n;
        cy /= n;
        let reach = 0;
        for (const q of poses?.values() ?? []) reach = Math.max(reach, Math.abs((q.x - cx) * hit.ux + (q.y - cy) * hit.uy));
        const made = { cx, cy, reach };
        spreads.set(index, made);
        return made;
      };
      for (const part of robot.parts.values()) {
        const hit = hitOf(part.group);
        if (!hit) continue;
        // A part that needs arming has its fuze off until it is armed (M10).
        if (part.def.impact && part.armed !== false && hit.dv > part.def.impact.speed) part.health = 0;
        // An armed charge with a crash fuze goes off on a hard hit (a ram), before crash damage could break it as a dud.
        const crash = part.def.charge?.crash;
        if (crash !== undefined && part.armed === true && part.fired !== true && part.health > 0 && hit.dv > crash) {
          part.fired = true;
          part.health = 0;
        }
        const fraction = crashFraction(hit.dv, part.def.crash);
        if (fraction > 0 && part.health > 0) {
          const spread = spreadOf(part.group, hit);
          const q = poseOf(part.id);
          const weight = crashWeight((q.x - spread.cx) * hit.ux + (q.y - spread.cy) * hit.uy, spread.reach);
          part.health -= part.def.health * fraction * weight;
        }
      }
    }
  }

  /**
   * Batch: an armed charge (`charge` in its def) goes off when any part cell of a robot of another team comes within its
   * `radius`: it is marked `fired` and set to 0 health, so the destroy step below gives it its blast (a charge destroyed
   * any other way is a dud). A burning flare counts as the robot it stands in for, like a sensor sees it (M11); a robot
   * nobody controls (debris, a wreck) does not count, like a contact of side none. Robots and parts are scanned in
   * order and the first cell in range sets it off, so the outcome never depends on anything but the state.
   */
  private checkCharges(): void {
    let charges: { robot: Robot; part: PartInstance }[] | undefined;
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        if (part.def.charge === undefined || part.armed !== true || part.health <= 0 || part.fired === true) continue;
        (charges ??= []).push({ robot, part });
      }
    }
    if (!charges) return;
    // What each robot is to a charge, worked out once on first use however many charges ask.
    const hulls = new Map<Robot, Hull>();
    const nearBody: boolean[] = [];
    for (const { robot, part } of charges) {
      const radius = part.def.charge?.radius ?? 0;
      const at = partWorldPose(this, robot, part.id);
      const sq = radius * radius;
      const near = (): boolean => {
        for (const other of this.robots) {
          if (other === robot) continue;
          let hull = hulls.get(other);
          if (!hull) {
            hull = this.hull(other);
            hulls.set(other, hull);
          }
          // Nothing of it can count: its own parts are a friend's or nobody's, and it carries no flare standing in for another robot.
          if (!hull.standIns && (other.team === robot.team || !this.controllers.has(other.id))) continue;
          // Only the bodies whose box (around their parts' cells) comes within the radius can have a cell in range.
          let any = false;
          for (let g = 0; g < hull.boxes.length; g++) {
            const box = hull.boxes[g];
            const close = box !== undefined && nearBox(box, hull.body(g), at, radius + CHARGE_SLACK);
            nearBody[g] = close;
            any ||= close;
          }
          if (!any) continue;
          for (const p of other.parts.values()) {
            if (!other.groups[p.group] || nearBody[p.group] !== true) continue;
            const decoy = (p.burn ?? 0) > 0 && p.decoyOf !== undefined && p.decoyOf !== other.id ? this.byId.get(p.decoyOf) : undefined;
            const seen = decoy ?? other;
            if (seen === robot || seen.team === robot.team || !this.controllers.has(seen.id)) continue;
            const b = hull.body(p.group);
            const pose = { x: b.s.x + b.c * p.localX - b.n * p.localY, y: b.s.y + b.n * p.localX + b.c * p.localY, angle: b.s.angle };
            const cells = (p.footprint ?? p.def.footprint).length === 1 ? [pose] : footprintPoses(pose, p);
            if (cells.some((c) => (c.x - at.x) ** 2 + (c.y - at.y) ** 2 <= sq)) return true;
          }
        }
        return false;
      };
      if (!near()) continue;
      part.fired = true;
      part.health = 0;
    }
  }

  /**
   * A robot as the charge check sees it: per body, the box around its parts' cells in the body's own frame (so a
   * charge far from every box skips the robot without looking at a part), each body's state read once, and whether
   * any of its parts is a burning flare standing in for another robot.
   */
  private hull(robot: Robot): Hull {
    const boxes: (HullBox | undefined)[] = [];
    let standIns = false;
    for (const p of robot.parts.values()) {
      if ((p.burn ?? 0) > 0 && p.decoyOf !== undefined && p.decoyOf !== robot.id) standIns = true;
      if (!robot.groups[p.group]) continue;
      let box = boxes[p.group];
      if (!box) {
        box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        boxes[p.group] = box;
      }
      const cells = p.footprint ?? p.def.footprint;
      if (cells.length === 1) {
        growBox(box, p.localX, p.localY);
      } else {
        for (const fc of cells) {
          const o = rotateCell(fc, p.rot);
          growBox(box, p.localX + o.x, p.localY + o.y);
        }
      }
    }
    const bodies: (BodyPose | undefined)[] = [];
    const body = (group: number): BodyPose => {
      let b = bodies[group];
      if (!b) {
        const s = this.physics.state(robot.groups[group]?.bodyId ?? 0);
        b = { s, c: Math.cos(s.angle), n: Math.sin(s.angle) };
        bodies[group] = b;
      }
      return b;
    };
    return { standIns, boxes, body };
  }

  /** Removes every part at 0 health (robots in order, parts in blueprint order) and queues its blast if it has one. */
  private destroyDeadParts(): void {
    for (const robot of this.robots) {
      // A robot holds its parts in blueprint order (`Robot.parts`), so a small piece of a big robot looks at its own
      // parts only, not at every part its blueprint ever had.
      for (const part of robot.parts.values()) {
        if (part.health > 0) continue;
        const pose = partWorldPose(this, robot, part.id);
        robot.parts.delete(part.id);
        this.dirty.add(robot);
        // An unarmed part that needs arming breaks like any other part (M10). A charge blasts only when it was set off
        // (Batch): shot or caught in a blast, it breaks as a dud.
        const explode = part.armed === false || (part.def.charge !== undefined && part.fired !== true) ? undefined : part.def.onDestroyed?.explode;
        this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'partDestroyed', part: part.id, partType: part.def.id, x: pose.x, y: pose.y, exploded: explode !== undefined, ...(part.burn === 0 ? { burntOut: true as const } : {}) });
        if (explode) this.queuedBlasts.push({ robot: robot.id, x: pose.x, y: pose.y, spec: explode });
      }
    }
  }

  /**
   * Rebuilds every changed robot into its pieces (`rebuildRobot`) and sorts out control (`04`): the robot keeps its
   * controller and scripts while its active core lives; without it, it latches its last values. A new piece latches
   * too, unless its single core woke up, which starts fresh with its parts' auto controls.
   */
  private rebuildDirty(): void {
    if (this.dirty.size > 0) {
      this.decoyCache = undefined;
      this.jamCache = undefined;
    }
    for (const robot of [...this.robots]) {
      if (!this.dirty.has(robot)) continue;
      this.dirty.delete(robot);
      const grew = this.grown.delete(robot);
      const controller = this.controllers.get(robot.id);
      const latched = controller ? controller.values(true) : (this.channels.get(robot.id) ?? new Map<string, Map<string, number>>());
      const pieces = rebuildRobot(
        {
          physics: this.physics,
          tick: this.tickCount,
          motion: (body) => this.motion(body),
          kick: (body, vx, vy, w) => this.pendingKicks.set(body, { vx, vy, w }),
          forget: (body) => {
            this.pendingKicks.delete(body);
            this.lastKicks.delete(body);
          },
          newRobotId: () => this.nextRobotId++,
          full: this.fullRebuild,
          tally: this.rebuilds,
        },
        robot,
      );
      if (pieces.length === 0) {
        this.removeRobot(robot);
        continue;
      }
      if (controller && robot.primaryCoreId === undefined) {
        this.controllers.delete(robot.id);
        this.runners.get(robot.id)?.dispose();
        this.runners.delete(robot.id);
        this.channels.set(robot.id, latchedFor(latched, robot));
        this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'coreLost' });
      } else if (controller && grew) {
        // It grew parts (M12): a controller for its new controls, keeping held keys and toggles.
        const grown = controllerFor(robot, this.registry);
        if (grown) {
          grown.carryFrom(controller);
          grown.restrict(new Set(robot.parts.keys()));
          this.controllers.set(robot.id, grown);
          this.channels.set(robot.id, grown.values());
        }
      } else if (controller) {
        controller.restrict(new Set(robot.parts.keys()));
        this.channels.set(robot.id, latchedFor(controller.values(), robot));
      } else {
        this.channels.set(robot.id, latchedFor(latched, robot));
      }
      for (const piece of pieces.slice(1)) {
        this.robots.push(piece);
        this.byId.set(piece.id, piece);
        const woke = piece.woke ? controllerFor(piece, this.registry) : undefined;
        if (woke) {
          this.controllers.set(piece.id, woke);
          this.channels.set(piece.id, woke.values());
          // A core with controls of its own (a placed missile's) starts its scripts; they first run next tick.
          this.startScripts(piece, coreControls(piece)?.scripts ?? []);
          this.events.push({ tick: this.tickCount, robot: piece.id, kind: 'coreWoke', from: robot.id });
        } else {
          this.channels.set(piece.id, latchedFor(latched, piece));
        }
      }
      if (pieces.length > 1) this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'split', pieces: pieces.slice(1).map((p) => p.id) });
    }
  }

  /**
   * A body's pose and motion. A kick not yet stepped, or stepped only once, is the body's real velocity (Rapier reports
   * a kicked link late); after one step it has also fallen for a step.
   */
  private motion(body: BodyId): BodyMotion {
    const s = this.physics.state(body);
    const mp = this.physics.massProperties(body);
    const base = { x: s.x, y: s.y, angle: s.angle, comX: mp.comX, comY: mp.comY };
    const k = this.pendingKicks.get(body);
    if (k) return { ...base, vx: k.vx, vy: k.vy, w: k.w };
    const last = this.lastKicks.get(body);
    if (last) return { ...base, vx: last.vx, vy: last.vy + this.gravityY * this.dt, w: last.w };
    return { ...base, vx: s.vx, vy: s.vy, w: s.w };
  }

  /** One blast: damage and push every part cell of every robot near it (`damage/explosion`). Terrain is immune. */
  private applyBlast(b: QueuedBlast): void {
    const reach = Math.max(b.spec.radius, b.spec.pushRadius) + 1;
    const targets: PartInstance[] = [];
    const cells: BlastCell[] = [];
    // Which target each cell belongs to: a multi-cell part (M12) has a cell for each footprint cell.
    const owners: number[] = [];
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        // Destroyed by an earlier blast in this batch: gone, so it neither takes damage nor covers anything.
        if (part.health <= 0) continue;
        const pose = partWorldPose(this, robot, part.id);
        const own = (part.footprint ?? part.def.footprint).length === 1 ? [pose] : footprintPoses(pose, part);
        const near = own.filter((c) => (c.x - b.x) ** 2 + (c.y - b.y) ** 2 <= reach * reach);
        if (near.length === 0) continue;
        for (const c of near) {
          cells.push(c);
          owners.push(targets.length);
        }
        targets.push(part);
      }
    }
    const fx = blastEffects({ x: b.x, y: b.y }, b.spec, cells, this.physics.terrainBoxes());
    // A part takes the damage of its worst hit cell, and the push of all its cells together, applied at its origin cell
    // (so an off-center hit on a big part does not turn it; fine for now).
    const damage = targets.map(() => 0);
    const push = targets.map(() => ({ jx: 0, jy: 0 }));
    owners.forEach((t, i) => {
      damage[t] = Math.max(damage[t] ?? 0, fx.damage[i] ?? 0);
      const p = fx.push[i];
      const into = push[t];
      if (p && into) {
        into.jx += p.jx;
        into.jy += p.jy;
      }
    });
    targets.forEach((part, i) => {
      const d = damage[i] ?? 0;
      const p = push[i];
      if (d > 0) part.health -= d;
      if (p && (p.jx !== 0 || p.jy !== 0)) this.pendingPushes.push({ part, jx: p.jx, jy: p.jy });
    });
    this.events.push({ tick: this.tickCount, robot: b.robot, kind: 'explosion', x: b.x, y: b.y, radius: b.spec.radius });
  }

  /**
   * Just before the physics step: kicks for new bodies, then pushes at each surviving part's cell, as forces for this
   * step. Every body of a kicked or pushed robot is unsettled for the next two steps: its velocity jumps for a reason
   * other than a hit, and a link reports it late.
   */
  private applyPendingForces(): void {
    const settle = (body: BodyId): void => {
      this.unsettled.set(body, Math.max(this.unsettled.get(body) ?? 0, this.tickCount + 2));
    };
    this.lastKicks = new Map(this.pendingKicks);
    for (const [body, k] of this.pendingKicks) {
      this.physics.kick(body, k.vx, k.vy, k.w);
      settle(body);
    }
    this.pendingKicks.clear();
    if (this.pendingPushes.length === 0) return;
    const owner = new Map<PartInstance, Robot>();
    for (const robot of this.robots) for (const part of robot.parts.values()) owner.set(part, robot);
    for (const p of this.pendingPushes) {
      const robot = owner.get(p.part);
      const group = robot?.groups[p.part.group];
      if (!robot || !group) continue;
      const pose = partWorldPose(this, robot, p.part.id);
      this.physics.addForceAt(group.bodyId, p.jx / this.dt, p.jy / this.dt, pose.x, pose.y);
      // A gun's kick and a shell's hit (M13) are too small to set off a fuze, and a robot under fire must keep its fuzes.
      if (!p.quiet) for (const g of robot.groups) settle(g.bodyId);
    }
    this.pendingPushes = [];
  }

  /**
   * A behavior's `detach` (a decoupler firing): the face stops attaching, the robot splits in the damage phase, and
   * the part and its neighbor across the face are pushed apart with `impulse` N s each.
   */
  private detach(robot: Robot, part: PartInstance, face: Face, impulse: number): void {
    part.cut = [...(part.cut ?? []), face];
    this.dirty.add(robot);
    const d = faceDir(face);
    const cellsOf = (p: PartInstance): { x: number; y: number }[] =>
      (p.footprint ?? p.def.footprint).map((fc) => {
        const off = rotateCell(fc, p.rot);
        return { x: p.x + off.x, y: p.y + off.y };
      });
    const across = new Set(cellsOf(part).map((c) => `${c.x + d.x},${c.y + d.y}`));
    // Only a part that was attached through that face (it has the opposite face there) is pushed away.
    const back = opposite(face);
    const neighbor = [...robot.parts.values()].find(
      (p) => p !== part && (p.footprint ?? p.def.footprint).some((fc) => {
        const off = rotateCell(fc, p.rot);
        return across.has(`${p.x + off.x},${p.y + off.y}`) && fc.faces.some((f) => rotateFace(f, p.rot) === back);
      }),
    );
    const s = this.physics.state(robot.groups[part.group]?.bodyId ?? 0);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const nx = c * d.x - n * d.y;
    const ny = n * d.x + c * d.y;
    this.pendingPushes.push({ part, jx: -nx * impulse, jy: -ny * impulse });
    if (neighbor) this.pendingPushes.push({ part: neighbor, jx: nx * impulse, jy: ny * impulse });
    const at = partWorldPose(this, robot, part.id);
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'decoupled', part: part.id, x: at.x + 0.5 * nx, y: at.y + 0.5 * ny });
  }

  /** Batch: what the grapple logic needs of the world. */
  private gh(): GrappleHost {
    const world = this;
    return (this.grappleHost ??= {
      physics: this.physics,
      dt: this.dt,
      robots: this.robots,
      events: this.events,
      get tick() {
        return world.tickCount;
      },
      controlled: (robot) => this.controllers.has(robot.id),
      input: (robot, part, name) => this.channels.get(robot.id)?.get(part.id)?.get(name) ?? 0,
      muzzle: (robot, part) => this.muzzle(robot, part),
    });
  }

  /** Batch: every grapple rope's two ends in the world, for drawing. Read only. */
  liveRopes(): { x1: number; y1: number; x2: number; y2: number; taut: boolean }[] {
    return this.grapples.segments(this.gh());
  }

  /** M13: shells in flight, oldest first, for drawing. Read only. */
  liveShells(): readonly Shell[] {
    return this.shells;
  }

  /**
   * Shells that hit something on the last tick, stopped where they hit, for drawing their last stretch (Logan: a gun
   * right up against its target fired and hit within one tick, so its shells were never drawn). Not simulation state.
   */
  spentShells(): readonly Shell[] {
    return this.spent;
  }

  /** M13: how many shells a robot's guns have fired so far. Reporting only. */
  shotsBy(robot: number): number {
    return this.shots.get(robot) ?? 0;
  }

  /**
   * M13, right after the physics step (Rapier's query index is fresh then): guns fire, shells fly, and every gun's
   * sight looks along its barrel. A gun fires while its `fire` input is above 0.5, once every `1 / rate` seconds; a
   * wreck (no core in charge) fires nothing. A shell moves one tick with gravity along a ray: the first collider on the
   * way (anyone's but its own gun's) takes its damage and a push and stops it; terrain just stops it.
   */
  private runGuns(): void {
    const guns: { robot: Robot; part: PartInstance }[] = [];
    for (const robot of this.robots) for (const part of robot.parts.values()) if (part.def.gun !== undefined) guns.push({ robot, part });
    this.spent = [];
    if (guns.length === 0 && this.shells.length === 0) return;
    // Shells in flight before this tick: only they can have met something coming the other way during it.
    const old = new Set(this.shells);
    const bodies = new Map<BodyId, Robot>();
    for (const robot of this.robots) for (const g of robot.groups) bodies.set(g.bodyId, robot);
    for (const { robot, part } of guns) {
      const spec = part.def.gun;
      if (!spec) continue;
      if ((part.cooldown ?? 0) > 0) part.cooldown = (part.cooldown ?? 0) - 1;
      if (part.health <= 0 || !this.controllers.has(robot.id) || (part.cooldown ?? 0) > 0) continue;
      if ((this.channels.get(robot.id)?.get(part.id)?.get('fire') ?? 0) <= 0.5) continue;
      const m = this.muzzle(robot, part);
      if (!m) continue;
      // Spread: off the barrel's line by up to `spread` degrees, center weighted (two draws averaged).
      const off = spec.spread > 0 ? ((spec.spread * Math.PI) / 180) * (noise(this.seed, this.tickCount, robot.id, part.id, 0) + noise(this.seed, this.tickCount, robot.id, part.id, 1) - 1) : 0;
      const sx = m.dx * Math.cos(off) - m.dy * Math.sin(off);
      const sy = m.dx * Math.sin(off) + m.dy * Math.cos(off);
      this.shells.push({
        x: m.x, y: m.y, px: m.x, py: m.y, vx: m.vx + sx * spec.speed, vy: m.vy + sy * spec.speed,
        robot: robot.id, gun: part.id, damage: spec.damage, push: spec.recoil, left: Math.max(1, Math.round(spec.life / this.dt)),
      });
      part.cooldown = Math.max(1, Math.round(1 / (spec.rate * this.dt)));
      if (spec.recoil > 0) this.pendingPushes.push({ part, jx: -m.dx * spec.recoil, jy: -m.dy * spec.recoil, quiet: true });
      this.shots.set(robot.id, (this.shots.get(robot.id) ?? 0) + 1);
    }
    if (this.shells.length > 0) this.flyShells(bodies, old);
    for (const { robot, part } of guns) this.look(robot, part, bodies);
  }

  /**
   * M13: a gun that has not looked yet (just spawned or built) knows which way it points: its `aim` from its pose, and
   * nothing seen yet. Without this a script would read aim 0 for a gun pointing left on its first tick.
   */
  private primeSights(robot: Robot): void {
    for (const part of robot.parts.values()) {
      if (!part.def.gun || part.sight) continue;
      const m = this.muzzle(robot, part);
      if (m) part.sight = { distance: part.def.gun.range, side: SIGHT.nothing, id: 0, aim: Math.atan2(m.dy, m.dx) };
    }
  }

  /** Where a gun's barrel ends, which way it points (a unit vector), and how fast that point moves (M13). */
  private muzzle(robot: Robot, part: PartInstance): { x: number; y: number; dx: number; dy: number; vx: number; vy: number } | undefined {
    const group = robot.groups[part.group];
    if (!group || part.def.acts === undefined) return undefined;
    const s = this.physics.state(group.bodyId);
    const com = this.physics.massProperties(group.bodyId);
    const pose = partWorldPose(this, robot, part.id);
    const f = faceDir(rotateFace(part.def.acts, part.rot));
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const dx = c * f.x - n * f.y;
    const dy = n * f.x + c * f.y;
    const x = pose.x + 0.5 * dx;
    const y = pose.y + 0.5 * dy;
    return { x, y, dx, dy, vx: s.vx - s.w * (y - com.comY), vy: s.vy + s.w * (x - com.comX) };
  }

  /**
   * Moves every shell one tick. The ray starts `SHELL_SWEEP * dt` behind where the shell was: a hit in that stretch
   * counts only if the body moved toward the shell enough this tick to have been ahead of it when the tick began (it
   * came through the shell). A shell fired this tick left from where its gun is now, so it has nothing behind it.
   */
  private flyShells(bodies: Map<BodyId, Robot>, old: Set<Shell>): void {
    const flying: Shell[] = [];
    for (const sh of this.shells) {
      sh.px = sh.x;
      sh.py = sh.y;
      sh.vy += this.gravityY * this.dt;
      const mx = sh.vx * this.dt;
      const my = sh.vy * this.dt;
      const len = Math.sqrt(mx * mx + my * my);
      if (len === 0) continue;
      const dx = mx / len;
      const dy = my / len;
      const back = old.has(sh) ? SHELL_SWEEP * this.dt : 0;
      const skip = (b: BodyId, owner: string | undefined): boolean => owner === sh.gun && bodies.get(b)?.id === sh.robot;
      const hits = this.physics.rayHits(sh.x - dx * back, sh.y - dy * back, dx, dy, len + back, skip);
      const hit = hits.find((h) => {
        if (h.distance >= back) return true;
        const v = this.physics.state(h.body);
        return -(v.vx * dx + v.vy * dy) * this.dt >= back - h.distance;
      });
      if (hit) {
        sh.x += dx * (hit.distance - back);
        sh.y += dy * (hit.distance - back);
        this.shellHit(sh, bodies.get(hit.body), hit.owner, dx, dy);
        this.spent.push(sh);
        continue;
      }
      sh.x += mx;
      sh.y += my;
      if (--sh.left > 0) flying.push(sh);
    }
    this.shells = flying;
  }

  private shellHit(sh: Shell, robot: Robot | undefined, owner: string | undefined, dx: number, dy: number): void {
    const part = owner === undefined ? undefined : robot?.parts.get(owner);
    // Terrain, or a part already destroyed this tick (its collider goes in the damage phase): the shell just stops.
    if (!robot || !part || part.health <= 0) return;
    const damage = sh.damage * (part.def.shellDamage ?? 1);
    // A shell is a hard knock: an armed part with an impact fuze (a warhead) goes off at once (Logan, after Gate 12).
    part.health = part.def.impact && part.armed !== false ? 0 : part.health - damage;
    if (sh.push > 0) this.pendingPushes.push({ part, jx: dx * sh.push, jy: dy * sh.push, quiet: true });
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'shellHit', part: part.id, partType: part.def.id, by: sh.robot, x: sh.x, y: sh.y, damage });
  }

  /**
   * A gun's sight (M13): the first thing straight out of its barrel within `range`, and whose it is, by the rule
   * contacts use (M8). A burning decoy (a flare) let go by a robot reads as that robot: the sight is a sensor too (M11).
   */
  private look(robot: Robot, part: PartInstance, bodies: Map<BodyId, Robot>): void {
    const spec = part.def.gun;
    const m = spec && part.health > 0 ? this.muzzle(robot, part) : undefined;
    if (!spec || !m) return;
    const sight: GunSight = { distance: spec.range, side: SIGHT.nothing, id: 0, aim: Math.atan2(m.dy, m.dx) };
    const hit = this.physics.castRay(m.x, m.y, m.dx, m.dy, spec.range, (b, owner) => owner === part.id && bodies.get(b) === robot);
    if (hit) {
      sight.distance = hit.distance;
      const hitRobot = bodies.get(hit.body);
      const hitPart = hit.owner === undefined ? undefined : hitRobot?.parts.get(hit.owner);
      if (!hitRobot || !hitPart) sight.side = SIGHT.terrain;
      else {
        const decoy = (hitPart.burn ?? 0) > 0 && hitPart.decoyOf !== undefined && hitPart.decoyOf !== hitRobot.id ? this.byId.get(hitPart.decoyOf) : undefined;
        const seen = decoy ?? hitRobot;
        sight.id = seen.id;
        sight.side = seen === robot ? SIGHT.own : !this.controllers.has(seen.id) ? SIGHT.none : seen.team === robot.team ? SIGHT.friend : SIGHT.enemy;
      }
    }
    part.sight = sight;
  }

  /** What a fabricator's recipe costs (M12): seconds of build and joules, from the recipe's mass and containers. */
  private jobOf(robot: Robot, part: PartInstance): { seconds: number; joules: number } | undefined {
    const spec = part.def.fabricate;
    // A wreck (no core in charge) builds nothing: nobody could fire it.
    if (!spec || !this.controllers.has(robot.id)) return undefined;
    let byPart = this.jobs.get(robot.blueprint);
    if (!byPart) this.jobs.set(robot.blueprint, (byPart = new Map()));
    if (byPart.has(part.id)) return byPart.get(part.id);
    const makes = robot.blueprint.parts.find((p) => p.id === part.id)?.makes;
    const recipe = makes === undefined ? undefined : robot.blueprint.recipes?.find((r) => r.name === makes);
    let job: { seconds: number; joules: number } | undefined;
    if (recipe) {
      const s = recipeStats(recipe.blueprint, this.registry);
      job = { seconds: Math.max(this.dt, buildSeconds(s, spec.secondsPerKg)), joules: spec.joulesPerKg * s.mass + s.stored };
    }
    byPart.set(part.id, job);
    return job;
  }

  /**
   * A fabricator's build is done (M12): once its hollow is clear of anything (the last copy may still be sliding
   * out), the recipe is placed into the live robot as `pnpm sim place` would (its own scope, its core asleep, full
   * health, containers full: the build paid for them), held by the bay's grips. The robot is rebuilt with the new
   * parts, and its controller with their controls, keeping its held keys and toggles.
   */
  private finishBuild(robot: Robot, bay: PartInstance): void {
    const placed = robot.blueprint.parts.find((p) => p.id === bay.id);
    const recipe = placed?.makes === undefined ? undefined : robot.blueprint.recipes?.find((r) => r.name === placed.makes);
    const group = robot.groups[bay.group];
    if (!placed || !recipe || !group) return;
    // A wreck (no core in charge) builds nothing: nobody could fire it.
    if (!this.controllers.has(robot.id)) return;
    const where = recipePlacement(placed, recipe.blueprint, this.registry);
    if (!where.ok) return this.blocked(robot, bay, where.error);
    // The hollow must be empty: probe each of its cells with a ball a little smaller than a cell (any tilt).
    const pose = partWorldPose(this, robot, bay.id);
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const probes = hollowAt(placed, bay.def).map((h) => {
      const dx = h.x - placed.x;
      const dy = h.y - placed.y;
      return { x: pose.x + c * dx - s * dy, y: pose.y + s * dx + c * dy, shape: { shape: 'ball' as const, radius: 0.45 } };
    });
    if (this.physics.overlapsShapes(probes)) {
      this.clearHollow(robot, bay, probes);
      return this.blocked(robot, bay, 'something is in its hollow');
    }
    this.clearing.delete(bay);
    const base = scopeBase(placed, bay.def);
    if (base === undefined) return this.blocked(robot, bay, 'it has no tag to name what it builds');
    const scope = `${base}${(bay.built ?? 0) + 1}`;
    const live: Blueprint = { ...robot.blueprint, parts: robot.blueprint.parts.filter((p) => robot.parts.has(p.id)) };
    const result = placeBlueprint(live, recipe.blueprint, where.at, this.registry, { rot: where.rot, scope, reservedIds: new Set(robot.blueprint.parts.map((p) => p.id)) });
    if (!result.ok) return this.blocked(robot, bay, result.error);
    const liveIds = new Set(live.parts.map((p) => p.id));
    const added = result.blueprint.parts
      .filter((p) => !liveIds.has(p.id))
      .map((p) => {
        const extra = (this.registry.get(p.part).defaultTags ?? []).filter((t) => !p.tags.includes(t));
        return extra.length > 0 ? { ...p, tags: [...p.tags, ...extra] } : p;
      });
    const oldCores = new Set((robot.blueprint.cores ?? []).map((k) => k.core));
    const cores = [...(robot.blueprint.cores ?? []), ...(result.blueprint.cores ?? []).filter((k) => !oldCores.has(k.core))];
    robot.blueprint = { ...robot.blueprint, parts: [...robot.blueprint.parts, ...added], ...(cores.length > 0 ? { cores } : {}) };
    const origin = robot.parts.get(group.originId);
    // New parts go last in the blueprint and last in the robot: `Robot.parts` stays in blueprint order.
    for (const p of added) {
      const def = this.registry.get(p.part);
      const inst: PartInstance = { id: p.id, def, x: p.x, y: p.y, rot: p.rot, tags: [...p.tags], health: def.health, group: bay.group, localX: p.x - (origin?.x ?? bay.x), localY: p.y - (origin?.y ?? bay.y) };
      if (def.resource) inst.stored = def.resource.capacity;
      const cells = footprintOf(def, p.size);
      if (cells !== def.footprint) inst.footprint = cells;
      if (def.arming === true) inst.armed = p.armed === true;
      if (def.fabricate) {
        inst.holding = false;
        inst.progress = 0;
        inst.built = 0;
      }
      robot.parts.set(p.id, inst);
    }
    bay.holding = true;
    bay.holds = scope;
    bay.progress = 0;
    bay.built = (bay.built ?? 0) + 1;
    this.stuck.delete(bay);
    this.dirty.add(robot);
    this.grown.add(robot);
    this.unprimed.add(robot);
    this.decoyCache = undefined;
    this.jamCache = undefined;
    for (const key of [...this.emptied]) if (key.startsWith(`${robot.id}:`)) this.emptied.delete(key);
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'built', part: bay.id, recipe: recipe.name, scope });
  }

  /**
   * Batch: a bay held up by pieces with no core (debris, a spent copy) pushes them out along its `acts` face once they
   * have been in the way for a second, every tick until clear. A piece with a live core is left alone (it may be a copy
   * leaving), and a bay whose only blocker is one of those never starts the clock.
   */
  private clearHollow(robot: Robot, bay: PartInstance, probes: readonly { x: number; y: number; shape: ShapeSpec }[]): void {
    const bodies = this.physics.overlappingBodies(probes);
    const loose: { part: PartInstance; mass: number }[] = [];
    for (const other of this.robots) {
      if (other === robot || this.controllers.has(other.id)) continue;
      for (const g of other.groups) {
        const part = other.parts.get(g.originId);
        if (part && bodies.includes(g.bodyId)) loose.push({ part, mass: this.physics.massProperties(g.bodyId).mass });
      }
    }
    if (loose.length === 0) {
      this.clearing.delete(bay);
      return;
    }
    const since = this.clearing.get(bay) ?? this.tickCount;
    this.clearing.set(bay, since);
    if (this.tickCount - since < bayClearAfterTicks(this.dt)) return;
    const d = faceDir(rotateFace(bay.def.acts ?? 'N', bay.rot));
    const s = this.physics.state(robot.groups[bay.group]?.bodyId ?? 0);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const nx = c * d.x - n * d.y;
    const ny = n * d.x + c * d.y;
    for (const l of loose) this.pendingPushes.push({ part: l.part, jx: nx * l.mass * BAY_CLEAR_SPEED, jy: ny * l.mass * BAY_CLEAR_SPEED });
  }

  /** A finished build that cannot be placed (M12): told once per wait, then tried again every tick. */
  private blocked(robot: Robot, bay: PartInstance, why: string): void {
    if (this.stuck.has(bay)) return;
    this.stuck.add(bay);
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'buildBlocked', part: bay.id, why });
  }

  /**
   * A fabricator lets go (M12): its grips stop holding, so the rebuild splits what it held off as its own piece (a
   * core in it wakes, as a missile let go from a decoupler does), pushed out along the bay's `acts` with the bay's
   * `separation`, the bay the other way.
   */
  private releaseBuild(robot: Robot, bay: PartInstance): void {
    const spec = bay.def.fabricate;
    if (!spec || bay.holding !== true) return;
    bay.holding = false;
    this.dirty.add(robot);
    const scope = bay.holds ?? '';
    delete bay.holds;
    const held = [...robot.parts.values()].filter((p) => p.tags[0] === scope);
    const d = faceDir(rotateFace(bay.def.acts ?? 'N', bay.rot));
    const s = this.physics.state(robot.groups[bay.group]?.bodyId ?? 0);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const nx = c * d.x - n * d.y;
    const ny = n * d.x + c * d.y;
    if (held.length > 0) {
      // Spread over the held parts, so it slides out without spinning.
      const j = spec.separation / held.length;
      for (const p of held) this.pendingPushes.push({ part: p, jx: nx * j, jy: ny * j });
      this.pendingPushes.push({ part: bay, jx: -nx * spec.separation, jy: -ny * spec.separation });
    }
    this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'released', part: bay.id, scope });
  }

  /**
   * Scripts run after key edges and before channels are final (`04`): they see this tick's keys and last tick's
   * channel values, and write the script layer. A crash disables only that script; the world keeps stepping.
   */
  private runScripts(): void {
    this.shareSight(() => this.runEveryScript());
  }

  /**
   * Runs `read` with the sensor pass's answers shared between everything it asks (as they are while scripts run), for
   * a caller that asks `sensorView` of many robots between two steps (the CLI's trace). `read` must not change the world.
   */
  shareSight<T>(read: () => T): T {
    if (this.pass) return read();
    this.pass = { refs: new Map(), sensors: new Map(), radios: new Map(), own: new Map(), scans: new Map(), scanTexts: new Map(), heads: new Map(), middles: new Map(), reports: new Map() };
    try {
      return read();
    } finally {
      this.pass = undefined;
    }
  }

  private runEveryScript(): void {
    for (const [robotId, runner] of this.runners) {
      const controller = this.controllers.get(robotId);
      const robot = this.byId.get(robotId);
      if (!controller || !robot) continue;
      for (const id of controller.takeScriptToggles()) runner.toggle(id);
      const services: ScriptServices = { scan: (id) => this.scan(robot, id), scanJson: (id) => this.scanJson(robot, id), send: (to, json) => this.send(robot, to, json) };
      if (this.scriptProbe) this.scriptProbe(robotId, () => this.scriptInput(robot, controller.keyState()));
      const out = runner.tick(() => this.scriptFrame(robot, controller.keyState()), services);
      if (out.ran) {
        // Its scripts have seen the messages sent before this tick; this tick's own sends stay for next tick.
        const core = robot.parts.get(robot.primaryCoreId ?? '');
        if (core?.inbox) {
          core.inbox = core.inbox.filter((m) => m.tick >= this.tickCount);
          if (core.inbox.length === 0) delete core.inbox;
        }
        this.scriptMarks.set(robotId, out.marks);
      } else {
        this.scriptMarks.delete(robotId);
      }
      for (const w of out.writes) controller.scriptWrite(w.target, w.channel, w.value);
      for (const c of out.crashes) this.events.push({ tick: this.tickCount, robot: robotId, kind: 'scriptCrashed', script: c.script, error: c.error });
      for (const l of out.logs) this.pushLog(robotId, l.script, l.text);
    }
  }

  private pushLog(robot: number, script: string, text: string): void {
    const second = Math.floor(this.tickCount * this.dt);
    const b = this.logBudget.get(robot);
    const budget = b && b.second === second ? b : { second, count: 0 };
    if (budget.count >= LOG_PER_SECOND) return;
    budget.count++;
    this.logBudget.set(robot, budget);
    this.scriptLogs.push({ tick: this.tickCount, robot, script, text });
    if (this.scriptLogs.length > LOG_KEEP) this.scriptLogs.splice(0, this.scriptLogs.length - LOG_KEEP);
  }

  /** Starts a robot's scripts. Each gets its own random stream from the world seed, the robot, and its place in the list. */
  private startScripts(robot: Robot, scripts: readonly ScriptSpec[]): void {
    if (scripts.length === 0) return;
    const seed = (i: number): number => (Math.imul(this.seed ^ 0x9e3779b9, 31) + Math.imul(robot.id, 65537) + i * 7919) >>> 0;
    this.runners.set(robot.id, new ScriptRunner(scripts, this.scriptHost, seed));
  }

  /**
   * What a robot's scripts see this tick (M9: as a frame, `script/frame.ts`). The layout is rebuilt when the robot
   * changes (`version`, its core) or when the values present on a part differ from the layout's; otherwise only the
   * numbers are written, into the same buffer as last tick.
   */
  private scriptFrame(robot: Robot, keys: ScriptInput['keys']): ScriptFrame {
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const key = `${robot.version}:${coreId}`;
    let feed = this.feeds.get(robot);
    if (!feed || feed.key !== key || !this.fillFeed(robot, feed)) {
      feed = this.buildFeed(robot, key, feed);
      if (!this.fillFeed(robot, feed)) throw new Error(`script layout of ${robot.name} did not match right after it was built`);
    }
    const inbox = (robot.parts.get(coreId)?.inbox ?? []).filter((m) => m.tick < this.tickCount).map((m) => ({ from: m.from, tick: m.tick, data: JSON.parse(m.data) as unknown }));
    const contacts = this.contactsFor(robot, true);
    return { layout: feed.layout, numbers: feed.numbers, extras: extrasJson({ keys, contacts, inbox }, this.contactsJson(contacts)) };
  }

  /** `JSON.stringify(contacts)` from the pieces the sensor pass kept; undefined when it kept none. */
  private contactsJson(contacts: readonly ScriptContact[]): string | undefined {
    const heads = this.pass?.heads;
    if (!heads || contacts.length === 0) return undefined;
    let text = '[';
    for (const c of contacts) {
      const head = heads.get(c);
      text += `${text.length > 1 ? ',' : ''}${head === undefined ? JSON.stringify(c) : contactJson(head, c.distance, c.by)}`;
    }
    return `${text}]`;
  }

  /** A new layout for the robot's controlled chunk, with the values present on each part right now. */
  private buildFeed(robot: Robot, key: string, last?: ScriptFeed): ScriptFeed {
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const chunk = chunkIndex(robot, coreId);
    const chans = this.channels.get(robot.id);
    const scope = coreControls(robot)?.scope;
    const pool = this.lazyPool(robot, chunk);
    const parts: ScriptFeed['parts'] = [];
    const layout: LayoutPart[] = [];
    for (const id of robot.chunks[chunk]?.partIds ?? []) {
      const p = robot.parts.get(id);
      if (!p) continue;
      const ins = [...(chans?.get(id)?.keys() ?? [])];
      const outs: string[] = [];
      for (const o of p.def.outputs) if (this.outputOf(p, o.name, pool) !== undefined) outs.push(o.name);
      parts.push({ id, part: p, in: ins, out: outs });
      layout.push({ id, type: p.def.id, tags: [...scopedView({ id, part: p.def.id, tags: p.tags }, scope).tags], mass: partMass(p.def, p.footprint), in: ins, out: outs });
    }
    // The robot's mass only changes when it is rebuilt, which makes a new layout.
    let mass = 0;
    for (const g of robot.groups) mass += this.physics.massProperties(g.bodyId).mass;
    // The whole layout as text is only made when a script needs it: one that holds the last layout takes the patch.
    let json: string | undefined;
    const patch = last && !this.fullLayouts ? layoutPatch(last.rows, layout) : undefined;
    const handed: ScriptLayout = {
      id: ++this.layouts,
      get json() {
        return (json ??= layoutJson(layout));
      },
      ...(last && patch !== undefined ? { patch: { from: last.layout.id, json: patch } } : {}),
    };
    const feed: ScriptFeed = { key, chunk, mass, layout: handed, rows: layout, parts, numbers: new Float64Array(numberCount(layout)) };
    this.feeds.set(robot, feed);
    return feed;
  }

  /**
   * Writes this tick's numbers into the feed (the header, `self`, every part); false when the robot no longer matches
   * its layout (a part gone, or a value that appeared or went away), so the caller rebuilds it. Each body's state is
   * read once, and the chunk's energy pool is added up once, however many parts ask for them.
   */
  private fillFeed(robot: Robot, feed: ScriptFeed): boolean {
    const chans = this.channels.get(robot.id);
    const n = feed.numbers;
    const pool = this.lazyPool(robot, feed.chunk);
    const bodies: (BodyPose | undefined)[] = [];
    const bodyOf = (group: number): BodyPose => {
      let b = bodies[group];
      if (!b) {
        const s = this.physics.state(robot.groups[group]?.bodyId ?? 0);
        b = { s, c: Math.cos(s.angle), n: Math.sin(s.angle) };
        bodies[group] = b;
      }
      return b;
    };
    let ok = true;
    let k = HEADER + SELF;
    for (const fp of feed.parts) {
      const part = fp.part;
      if (robot.parts.get(fp.id) !== part || !robot.groups[part.group]) return false;
      const { s, c, n: sn } = bodyOf(part.group);
      ok = put(n, k++, s.x + c * part.localX - sn * part.localY) && ok;
      ok = put(n, k++, s.y + sn * part.localX + c * part.localY) && ok;
      ok = put(n, k++, s.angle) && ok;
      const values = chans?.get(fp.id);
      if ((values?.size ?? 0) !== fp.in.length) return false;
      if (values) {
        let j = 0;
        for (const [name, v] of values) {
          if (fp.in[j++] !== name) return false;
          ok = put(n, k++, v) && ok;
        }
      }
      let j = 0;
      for (const o of part.def.outputs) {
        const v = this.outputOf(part, o.name, pool);
        if ((v !== undefined) !== (fp.out[j] === o.name)) return false;
        if (v === undefined) continue;
        j++;
        ok = put(n, k++, v) && ok;
      }
      if (j !== fp.out.length) return false;
    }
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const core = robot.parts.get(coreId);
    const { s, c, n: sn } = bodyOf(core?.group ?? 0);
    const lx = core?.localX ?? 0;
    const ly = core?.localY ?? 0;
    // The energy of the chunk the robot is controlled through (`energy()`): the core's, which is the feed's chunk.
    const energy = robot.primaryCoreId === undefined ? poolTotals(poolContainers(robot, 0)) : pool();
    ok = put(n, 1, this.tickCount) && ok;
    ok = put(n, 2, this.dt) && ok;
    ok = put(n, 3, this.tickCount * this.dt) && ok;
    k = HEADER;
    ok = put(n, k++, s.x + c * lx - sn * ly) && ok;
    ok = put(n, k++, s.y + sn * lx + c * ly) && ok;
    ok = put(n, k++, s.vx) && ok;
    ok = put(n, k++, s.vy) && ok;
    ok = put(n, k++, s.angle) && ok;
    ok = put(n, k++, s.w) && ok;
    ok = put(n, k++, feed.mass) && ok;
    ok = put(n, k++, energy.stored) && ok;
    ok = put(n, k++, energy.capacity) && ok;
    n[0] = ok ? 1 : 0;
    return true;
  }

  /** A chunk's energy totals, added up on first use. */
  private lazyPool(robot: Robot, chunk: number): () => { stored: number; capacity: number } {
    let totals: { stored: number; capacity: number } | undefined;
    return () => (totals ??= poolTotals(poolContainers(robot, chunk)));
  }

  /** `partOutput` for a part and an output name it is known to have, with its chunk's pool (M9: no lookups). */
  private outputOf(part: PartInstance, name: string, pool: () => { stored: number; capacity: number }): number | undefined {
    const own = part.def.behavior === undefined ? undefined : BEHAVIORS.get(part.def.behavior)?.output?.(part, name);
    if (own !== undefined) return own;
    if (name === 'charge') return part.stored !== undefined && part.def.resource ? part.stored / part.def.resource.capacity : undefined;
    if (name === 'energy' || name === 'energyCapacity') return name === 'energy' ? pool().stored : pool().capacity;
    if (name === 'armed' && part.armed !== undefined) return part.armed ? 1 : 0;
    if (name === 'burning' && part.def.decoy !== undefined) return (part.burn ?? 0) > 0 ? 1 : 0;
    if (name === 'jamming' && part.def.jammer !== undefined) return (part.burn ?? 0) > 0 ? 1 : 0;
    if (part.def.gun !== undefined) return gunOutput(part, name);
    if (part.def.grapple !== undefined) return this.grapples.output(part, name);
    return undefined;
  }

  /**
   * The input as the scripts saw it before M9 (`04`, Script API): exact data about the core and its parts. Kept as the
   * reference the parity test compares `scriptFrame` against (`scriptProbe`); the world no longer runs it.
   */
  private scriptInput(robot: Robot, keys: ScriptInput['keys']): ScriptInput {
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const core = partWorldPose(this, robot, coreId);
    const coreBody = robot.groups[robot.parts.get(coreId)?.group ?? 0]?.bodyId ?? 0;
    const s = this.physics.state(coreBody);
    let mass = 0;
    for (const g of robot.groups) mass += this.physics.massProperties(g.bodyId).mass;
    const energy = referenceEnergy(robot);
    const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
    const chans = this.channels.get(robot.id);
    const scope = coreControls(robot)?.scope;
    const parts: ScriptInput['parts'] = [];
    for (const id of chunk?.partIds ?? []) {
      const p = robot.parts.get(id);
      if (!p) continue;
      const pose = partWorldPose(this, robot, id);
      const out: Record<string, number> = {};
      for (const o of p.def.outputs) {
        const v = referenceOutput(robot, p, id, o.name);
        if (v !== undefined) out[o.name] = v;
      }
      parts.push({ id, type: p.def.id, tags: [...scopedView({ id, part: p.def.id, tags: p.tags }, scope).tags], pos: { x: pose.x, y: pose.y }, angle: pose.angle, mass: partMass(p.def, p.footprint), in: Object.fromEntries(chans?.get(id) ?? []), out });
    }
    return {
      frame: this.tickCount,
      dt: this.dt,
      time: this.tickCount * this.dt,
      self: {
        pos: { x: core.x, y: core.y },
        vel: { x: s.vx, y: s.vy },
        angle: s.angle,
        angVel: s.w,
        mass,
        energy: { stored: energy?.stored ?? 0, capacity: energy?.capacity ?? 0 },
      },
      parts,
      keys,
      contacts: this.contactsFor(robot, true),
      inbox: (robot.parts.get(coreId)?.inbox ?? []).filter((m) => m.tick < this.tickCount).map((m) => ({ from: m.from, tick: m.tick, data: JSON.parse(m.data) as unknown })),
    };
  }

  /**
   * `send(to, data)` (M8): queues a message for a core attached to the sender's robot (in its controlled chunk), named
   * by its scope as the sender sees it (`missile1`), a tag it carries, or its part id. Its scripts see it from the next tick. No radio yet:
   * a core that is not attached cannot be reached.
   */
  private send(robot: Robot, to: string, json: string): boolean {
    const own = robot.primaryCoreId;
    if (own === undefined || json.length > 1024) return false;
    const chunk = robot.chunks.find((c) => c.partIds.includes(own));
    const scope = coreControls(robot)?.scope;
    const wanted = scope === undefined ? to : `${scope}.${to}`;
    const target = chunk?.partIds.find((id) => {
      if (id === own) return false;
      const p = robot.parts.get(id);
      if (!p || p.def.role !== 'core') return false;
      return id === to || p.tags.includes(wanted) || robot.blueprint.cores?.some((c) => c.core === id && c.scope === wanted) === true;
    });
    const part = target === undefined ? undefined : robot.parts.get(target);
    if (!part) return false;
    // At most SENDS_PER_TICK per robot per tick, whatever its scripts do (each script has its own cap of 32 too).
    const count = this.sendsThisTick.tick === this.tickCount ? (this.sendsThisTick.counts.get(robot.id) ?? 0) : 0;
    if (this.sendsThisTick.tick !== this.tickCount) this.sendsThisTick = { tick: this.tickCount, counts: new Map() };
    if (count >= SENDS_PER_TICK) return false;
    this.sendsThisTick.counts.set(robot.id, count + 1);
    part.inbox = [...(part.inbox ?? []), { from: own, tick: this.tickCount, data: json }].slice(-16);
    // Reported at most once a second per sender and receiver: a launcher streaming updates every tick would otherwise
    // fill the event list (events are kept for the whole run).
    const key = `${robot.id}>${part.id}`;
    const last = this.lastSentEvent.get(key);
    if (last === undefined || this.tickCount - last >= Math.round(1 / this.dt)) {
      this.lastSentEvent.set(key, this.tickCount);
      this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'sent', to: part.id, data: json });
    }
    return true;
  }

  /** What a robot's scripts marked when they last ran (M8), for the overlay and reports. */
  marks(robotId: number): readonly ScriptMark[] {
    return (this.scriptMarks.get(robotId) ?? []).flatMap((m) => m.marks);
  }

  /** Fixed terrain boxes (the ground and world boxes): what blocks a sensor's view. */
  private terrainBoxes(): TerrainBox[] {
    this.terrain ??= this.physics.terrainBoxes();
    return this.terrain;
  }

  /** The sensor parts of the robot's controlled chunk that work this tick (switched on and powered last tick), in part order. */
  private workingSensors(robot: Robot): SensorPose[] {
    const known = this.pass?.sensors.get(robot);
    if (known) return known;
    const out = this.readSensors(robot);
    this.pass?.sensors.set(robot, out);
    return out;
  }

  private readSensors(robot: Robot): SensorPose[] {
    const coreId = robot.primaryCoreId;
    if (coreId === undefined || !this.controllers.has(robot.id)) return [];
    const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
    const out: SensorPose[] = [];
    const bubbles = this.jamBubbles();
    for (const id of chunk?.partIds ?? []) {
      const p = robot.parts.get(id);
      const spec = p?.def.sensor;
      // A sensor works only once it has been powered (the behavior sets `sensing` each tick); before its first tick it sees nothing.
      if (!p || !spec || p.sensing !== true) continue;
      const pose = partWorldPose(this, robot, id);
      // Batch: a sensor inside a jammer's bubble sees nothing.
      if (bubbles && jammed(bubbles, pose)) continue;
      const d = faceDir(rotateFace(p.def.acts ?? 'N', p.rot));
      out.push({ id, x: pose.x, y: pose.y, facing: pose.angle + Math.atan2(d.y, d.x), cone: spec.cone, range: spec.range });
    }
    return out;
  }

  /** Where a robot is for sensors: its live core, else its center of mass; with its mass and center either way. */
  private reference(r: Robot): Reference {
    const known = this.pass?.refs.get(r);
    if (known) return known;
    const out = this.readReference(r);
    this.pass?.refs.set(r, out);
    return out;
  }

  private readReference(r: Robot): Reference {
    let mass = 0;
    let cx = 0;
    let cy = 0;
    let vx = 0;
    let vy = 0;
    for (const g of r.groups) {
      const mp = this.physics.massProperties(g.bodyId);
      const s = this.physics.state(g.bodyId);
      mass += mp.mass;
      cx += mp.mass * mp.comX;
      cy += mp.mass * mp.comY;
      vx += mp.mass * s.vx;
      vy += mp.mass * s.vy;
    }
    const center = mass > 0 ? { x: cx / mass, y: cy / mass } : { x: r.spawnX, y: r.spawnY };
    const coreId = r.primaryCoreId;
    const core = coreId !== undefined && this.controllers.has(r.id) && r.parts.has(coreId);
    if (core) {
      const pose = partWorldPose(this, r, coreId);
      const s = this.physics.state(r.groups[r.parts.get(coreId)?.group ?? 0]?.bodyId ?? 0);
      return { core, pos: { x: pose.x, y: pose.y }, vel: { x: s.vx, y: s.vy }, center, mass };
    }
    return { core, pos: center, vel: mass > 0 ? { x: vx / mass, y: vy / mass } : { x: 0, y: 0 }, center, mass };
  }

  /**
   * Every robot the robot's working sensors see, nearest first (ties by id). `remember` keeps the ids for `scan()`
   * this tick; the overlay's read-only view does not. `decoysOut` gets the contacts reported at a decoy.
   *
   * M11: a burning decoy stands in for the robot it was part of when lit. When a sensor sees one, that robot is
   * reported at the decoy (its position and velocity; the robot's id, side, core, mass, and part count), whether or
   * not the robot is also in view; of several, the one nearest the viewer. A decoy still on its robot is just one of its
   * parts. A piece whose parts are all burning decoys for another robot is not listed as itself; a piece with anything
   * else on it is (the shipped racks let each flare go alone). Nothing here names a kind of robot: whatever steers by these contacts is fooled as a result.
   */
  private contactsFor(robot: Robot, remember: boolean, decoysOut?: Map<number, SeenDecoy>): ScriptContact[] {
    const own = this.ownContacts(robot, remember, decoysOut);
    const radios = this.workingRadios(robot);
    if (radios.length === 0) return own;
    return this.withRadio(robot, own, radios, decoysOut);
  }

  /** The radio parts of the robot's controlled chunk that work this tick (switched on and powered last tick, not inside a jammer's bubble), in part order. */
  private workingRadios(robot: Robot): RadioPose[] {
    const known = this.pass?.radios.get(robot);
    if (known) return known;
    const out = this.readRadios(robot);
    this.pass?.radios.set(robot, out);
    return out;
  }

  private readRadios(robot: Robot): RadioPose[] {
    const coreId = robot.primaryCoreId;
    if (coreId === undefined || !this.controllers.has(robot.id)) return [];
    const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
    const out: RadioPose[] = [];
    const bubbles = this.jamBubbles();
    for (const id of chunk?.partIds ?? []) {
      const p = robot.parts.get(id);
      const spec = p?.def.radio;
      if (!p || !spec || p.sensing !== true) continue;
      const pose = partWorldPose(this, robot, id);
      // Batch (integration): a radio inside a jammer's bubble neither sends nor hears, like a sensor there.
      if (bubbles && jammed(bubbles, pose)) continue;
      out.push({ x: pose.x, y: pose.y, range: spec.range });
    }
    return out;
  }

  /**
   * Batch, radio: adds what each teammate in radio range sees with its own sensors (never what it was told by radio, so
   * no relaying) to the robot's own contacts, unless the robot already sees that robot itself. A shared contact is
   * reported as the teammate saw it (a flare it took for a robot still fools), with `distance` measured from this
   * robot's core, and `by: ['radio']`. Of several teammates seeing the same robot, the one whose report is nearest wins
   * (ties: robot order). Shared contacts are never remembered for `scan(id)`.
   */
  private withRadio(robot: Robot, own: ScriptContact[], radios: RadioPose[], decoysOut?: Map<number, SeenDecoy>): ScriptContact[] {
    const from = partWorldPose(this, robot, robot.primaryCoreId ?? robot.rootId);
    const have = new Set(own.map((c) => c.id));
    const reach = new Map<Robot, boolean>();
    const inReach = (friend: Robot): boolean => {
      let near = reach.get(friend);
      if (near === undefined) {
        const theirs = this.workingRadios(friend);
        // In reach when some pair of working radios is within both ranges.
        near = radios.some((a) => theirs.some((b) => Math.hypot(a.x - b.x, a.y - b.y) <= Math.min(a.range, b.range)));
        reach.set(friend, near);
      }
      return near;
    };
    const shared: { first: Report; contact: ScriptContact; decoy: SeenDecoy | undefined }[] = [];
    for (const [id, reports] of this.teamReports(robot.team)) {
      if (id === robot.id || have.has(id)) continue;
      // The reports of one robot, teammates in robot order: the nearest wins, the earlier one on a tie.
      let first: Report | undefined;
      let best: Report | undefined;
      let least = 0;
      for (const r of reports) {
        if (r.friend === robot || !inReach(r.friend)) continue;
        first ??= r;
        const distance = Math.hypot(r.contact.pos.x - from.x, r.contact.pos.y - from.y);
        if (best && least <= distance) continue;
        best = r;
        least = distance;
      }
      if (!first || !best) continue;
      const contact = { ...best.contact, distance: least, by: ['radio'] };
      const head = this.pass?.heads.get(best.contact);
      if (head !== undefined) this.pass?.heads.set(contact, head);
      shared.push({ first, contact, decoy: best.decoy });
    }
    if (shared.length === 0) return own;
    // In the order a walk over the teammates, then over each one's contacts, first comes to them.
    shared.sort((a, b) => a.first.order - b.first.order || a.first.index - b.first.index);
    for (const s of shared) if (s.decoy) decoysOut?.set(s.contact.id, s.decoy);
    const out = [...own, ...shared.map((s) => s.contact)];
    out.sort((a, b) => a.distance - b.distance || a.id - b.id);
    return out;
  }

  /**
   * What a team's robots with a working radio see with their own sensors, by the robot seen, each list in robot
   * order: every listener of the team picks from the same lists (see `withRadio`).
   */
  private teamReports(team: number): Map<number, Report[]> {
    const known = this.pass?.reports.get(team);
    if (known) return known;
    const out = new Map<number, Report[]>();
    this.robots.forEach((friend, order) => {
      if (friend.team !== team || friend.groups.length === 0 || this.workingRadios(friend).length === 0) return;
      const sight = this.sightOf(friend);
      sight.contacts.forEach((contact, index) => {
        let list = out.get(contact.id);
        if (!list) {
          list = [];
          out.set(contact.id, list);
        }
        list.push({ friend, order, index, contact, decoy: sight.fooled?.get(contact.id) });
      });
    });
    this.pass?.reports.set(team, out);
    return out;
  }

  /** What the robot's own sensors see (see contactsFor). */
  private ownContacts(robot: Robot, remember: boolean, decoysOut?: Map<number, SeenDecoy>): ScriptContact[] {
    const sight = this.sightOf(robot);
    if (remember) {
      this.seen.delete(robot.id);
      this.seenDecoys.delete(robot.id);
      if (sight.sensors) {
        this.seen.set(robot.id, sight.contacts);
        if (sight.fooled && sight.fooled.size > 0) this.seenDecoys.set(robot.id, sight.fooled);
      }
    }
    if (decoysOut && sight.fooled) for (const [id, d] of sight.fooled) decoysOut.set(id, d);
    return sight.contacts;
  }

  private sightOf(robot: Robot): OwnSight {
    const known = this.pass?.own.get(robot);
    if (known) return known;
    const out = this.lookAround(robot);
    this.pass?.own.set(robot, out);
    return out;
  }

  /** One look with the robot's own sensors: the same for its scripts, a radio friend, and the overlay. */
  private lookAround(robot: Robot): OwnSight {
    const sensors = this.workingSensors(robot);
    if (sensors.length === 0) return { sensors: false, contacts: [] };
    const terrain = this.terrainBoxes();
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const from = partWorldPose(this, robot, coreId);
    const lit = this.burningDecoys();
    const bubbles = this.jamBubbles();
    const fooled = lit ? new Map<number, SeenDecoy>() : undefined;
    const pass = this.pass;
    const out: ScriptContact[] = [];
    for (const other of this.robots) {
      if (other === robot || other.groups.length === 0 || lit?.pieces.has(other.id)) continue;
      const ref = this.reference(other);
      let at: SeenDecoy | undefined;
      let by: string[] = [];
      let best = Infinity;
      const decoys = lit?.of.get(other.id);
      for (const d of decoys ?? NO_DECOYS) {
        // One still on the robot it stands in for is just part of it (lit, not let go yet).
        if (d.robot === other) continue;
        const dist = Math.hypot(d.pos.x - from.x, d.pos.y - from.y);
        if (dist >= best || (bubbles && jammed(bubbles, d.pos))) continue;
        const b = sensors.filter((s) => sees(s, d.pos, terrain, this.clouds)).map((s) => s.id);
        if (b.length === 0) continue;
        at = d;
        by = b;
        best = dist;
      }
      if (!at) {
        // Batch: a robot whose reference point is inside a jammer's bubble is hidden from every sensor outside it.
        if (bubbles && jammed(bubbles, ref.pos)) continue;
        by = sensors.filter((s) => sees(s, ref.pos, terrain, this.clouds)).map((s) => s.id);
        if (by.length === 0) continue;
      }
      const pos = at ? at.pos : ref.pos;
      const side = !this.controllers.has(other.id) ? 'none' : other.team === robot.team ? 'friend' : 'enemy';
      if (at) fooled?.set(other.id, at);
      // Seen at a decoy, its center keeps the same offset from its position as the robot's own.
      const center = at ? { x: at.pos.x + ref.center.x - ref.pos.x, y: at.pos.y + ref.center.y - ref.pos.y } : ref.center;
      const contact: ScriptContact = { id: other.id, side, core: ref.core, pos, vel: at ? at.vel : ref.vel, center, mass: ref.mass, parts: other.parts.size, distance: Math.hypot(pos.x - from.x, pos.y - from.y), by };
      out.push(contact);
      if (!pass) continue;
      // Its JSON text up to the distance: all but the side is the same for every viewer, unless it is seen at a decoy.
      let middle = at ? undefined : pass.middles.get(other);
      if (middle === undefined) {
        middle = contactMiddle(contact);
        if (!at) pass.middles.set(other, middle);
      }
      pass.heads.set(contact, contactHead(other.id, side, middle));
    }
    out.sort((a, b) => a.distance - b.distance || a.id - b.id);
    return { sensors: true, contacts: out, ...(fooled ? { fooled } : {}) };
  }

  /**
   * Every burning decoy now, by the robot it stands in for, and the pieces made only of decoys standing in for another
   * robot (M11). Undefined when none has been lit (the usual case costs nothing). Computed once per tick.
   */
  private burningDecoys(): { of: Map<number, SeenDecoy[]>; pieces: Set<number> } | undefined {
    if (this.decoys.size === 0) return undefined;
    if (this.decoyCache?.tick === this.tickCount) return this.decoyCache.view;
    const of = new Map<number, SeenDecoy[]>();
    const pieces = new Set<number>();
    this.decoys.clear();
    for (const r of this.robots) {
      let others = 0;
      for (const bp of r.blueprint.parts) {
        const part = r.parts.get(bp.id);
        if (!part || (part.burn ?? 0) <= 0 || part.decoyOf === undefined) continue;
        this.decoys.add(part);
        if (part.decoyOf !== r.id) others++;
        const group = r.groups[part.group];
        if (!group) continue;
        const pose = partWorldPose(this, r, part.id);
        const s = this.physics.state(group.bodyId);
        const list = of.get(part.decoyOf) ?? [];
        list.push({ robot: r, partId: part.id, pos: { x: pose.x, y: pose.y }, vel: { x: s.vx, y: s.vy } });
        of.set(part.decoyOf, list);
      }
      if (others > 0 && others === r.parts.size) pieces.add(r.id);
    }
    const view = this.decoys.size === 0 ? undefined : { of, pieces };
    this.decoyCache = { tick: this.tickCount, view };
    return view;
  }

  /**
   * `scan(id)` (M8): a robot the viewer's sensors saw this tick, part by part, in blueprint order; null otherwise.
   * M11: a robot seen at a decoy scans as what the sensor sees there: the decoy.
   */
  private scan(viewer: Robot, id: number): ScannedPart[] | null {
    if (!this.seen.get(viewer.id)?.some((c) => c.id === id)) return null;
    const decoy = this.seenDecoys.get(viewer.id)?.get(id);
    const r = decoy ? decoy.robot : this.byId.get(id);
    if (!r) return null;
    // A whole robot's list is the same for every script that scans it this tick; one seen at a decoy is that one part.
    const known = decoy ? undefined : this.pass?.scans.get(r);
    if (known) return known;
    const poseOf = this.poser(r);
    const out: ScannedPart[] = [];
    for (const bp of r.blueprint.parts) {
      const p = r.parts.get(bp.id);
      if (!p || (decoy && p.id !== decoy.partId)) continue;
      const pose = poseOf(p);
      out.push({ id: p.id, type: p.def.id, pos: { x: pose.x, y: pose.y }, angle: pose.angle, health: p.health, maxHealth: p.def.health });
    }
    if (!decoy) this.pass?.scans.set(r, out);
    return out;
  }

  /** `scan(id)` as the JSON text a script host hands its script, kept with the list so the text is made once a tick. */
  private scanJson(viewer: Robot, id: number): string {
    const parts = this.scan(viewer, id);
    if (parts === null) return 'null';
    const known = this.pass?.scanTexts.get(parts);
    if (known !== undefined) return known;
    const text = JSON.stringify(parts);
    this.pass?.scanTexts.set(parts, text);
    return text;
  }

  /**
   * `partWorldPose` for many parts of one robot: each body's state, and the cosine and sine of its angle, is read once
   * however many of its parts ask. The same arithmetic, so the same numbers.
   */
  private poser(robot: Robot): (part: PartInstance) => { x: number; y: number; angle: number } {
    const bodies: (BodyPose | undefined)[] = [];
    return (part) => {
      let b = bodies[part.group];
      if (!b) {
        const group = robot.groups[part.group];
        // No body: the plain reader says what is wrong.
        if (!group) return partWorldPose(this, robot, part.id);
        const s = this.physics.state(group.bodyId);
        b = { s, c: Math.cos(s.angle), n: Math.sin(s.angle) };
        bodies[part.group] = b;
      }
      return { x: b.s.x + b.c * part.localX - b.n * part.localY, y: b.s.y + b.n * part.localX + b.c * part.localY, angle: b.s.angle };
    };
  }

  /**
   * What a robot's sensors see now, for the debug overlay (M8): each working sensor and each contact. Read-only; the
   * same rule scripts get. `decoy` marks a contact seen at a decoy (M11), which scripts are never told.
   */
  sensorView(robotId: number): { sensors: SensorPose[]; contacts: { id: number; side: ScriptContact['side']; x: number; y: number; decoy?: true }[] } {
    const robot = this.byId.get(robotId);
    if (!robot) return { sensors: [], contacts: [] };
    const fooled = new Map<number, SeenDecoy>();
    const contacts = this.contactsFor(robot, false, fooled);
    return { sensors: this.workingSensors(robot), contacts: contacts.map((c) => ({ id: c.id, side: c.side, x: c.pos.x, y: c.pos.y, ...(fooled.has(c.id) ? { decoy: true as const } : {}) })) };
  }

  /** A robot's scripts and whether each runs or crashed. Read-only. */
  scripts(robotId: number): readonly { id: string; enabled: boolean; crashed?: ScriptError }[] {
    return this.runners.get(robotId)?.scripts ?? [];
  }

  /** Unlimited energy on or off, from the next tick on (logged, so replays match). */
  setUnlimitedEnergy(on: boolean): void {
    this.pendingUnlimited = on === this.unlimited ? undefined : on;
  }

  get unlimitedEnergy(): boolean {
    return this.pendingUnlimited ?? this.unlimited;
  }

  /**
   * Every part with a known behavior plans its action, each chunk's pool grants what it can (`05`: proportional
   * brownout), then every action runs with its grant. Robots in spawn order, parts in blueprint order. `early` runs
   * only the behaviors that change structure (decouplers), the rest only the others.
   */
  private runBehaviors(early: boolean): void {
    for (const robot of this.robots) {
      const planned: { action: PlannedAction; chunk: number; request: number }[] = [];
      const chans = this.channels.get(robot.id);
      for (const part of robot.parts.values()) {
        const behavior = part.def.behavior === undefined ? undefined : BEHAVIORS.get(part.def.behavior);
        const group = robot.groups[part.group];
        if (!behavior || !group || (behavior.early === true) !== early) continue;
        const own = chans?.get(part.id);
        const ctx: BehaviorContext = {
          physics: this.physics,
          robot,
          part,
          group,
          dt: this.dt,
          value: (channel) => own?.get(channel) ?? part.def.inputs.find((c) => c.name === channel)?.default ?? 0,
          config: (key) => part.def.behaviorConfig?.[key] ?? 0,
          detach: (face, impulse) => this.detach(robot, part, face, impulse),
          job: () => this.jobOf(robot, part),
          finish: () => this.finishBuild(robot, part),
          release: () => this.releaseBuild(robot, part),
        };
        const action = behavior.plan(ctx);
        // A load that is not a number (a hand-made def dividing by zero) must never reach the pool: NaN would stick.
        const load = Number.isFinite(action?.load) ? Math.max(0, Math.min(1, action?.load ?? 0)) : 0;
        if (action) planned.push({ action, chunk: chunkIndex(robot, part.id), request: part.def.powerDraw * load * this.dt });
      }
      const grants = robot.chunks.map((_, c) => this.resolvePool(robot, c, planned.filter((p) => p.chunk === c).reduce((s, p) => s + p.request, 0)));
      // A part that asks for nothing (no power draw, or idle) acts in full whatever the pool holds.
      for (const p of planned) p.action.run(p.request > 0 ? (grants[p.chunk] ?? 0) : 1);
    }
  }

  /** Grants a chunk's requests for this tick and drains its pool. Returns the grant factor. */
  private resolvePool(robot: Robot, chunk: number, requested: number): number {
    if (requested <= 0) return 1;
    if (this.unlimited) return 1;
    const containers = poolContainers(robot, chunk);
    const { stored } = poolTotals(containers);
    const grant = grantFactor(stored, requested);
    const taken = drainContainers(containers, Math.min(requested, stored));
    for (const c of containers) {
      const part = robot.parts.get(c.id);
      if (part) part.stored = c.stored;
    }
    this.used.set(robot.id, (this.used.get(robot.id) ?? 0) + taken);
    const key = `${robot.id}:${chunk}`;
    // Only a pool this tick actually emptied: a chunk that never held energy never "runs out".
    if (taken > 0 && stored - taken <= 0 && !this.emptied.has(key)) {
      this.emptied.add(key);
      this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'energyEmpty', chunk });
    }
    return grant;
  }

  /**
   * A part's output channel (`05`, `04`): `charge` on a container is its own stored fraction; `energy` and
   * `energyCapacity` are its chunk's pool. Other outputs (sensors) arrive with scripts (M5); undefined until then.
   */
  partOutput(robotId: number, partId: string, name: string): number | undefined {
    const robot = this.byId.get(robotId);
    const part = robot?.parts.get(partId);
    if (!robot || !part || !part.def.outputs.some((o) => o.name === name)) return undefined;
    return this.outputOf(part, name, this.lazyPool(robot, chunkIndex(robot, partId)));
  }

  /**
   * A robot's energy: the pool of the chunk it is controlled through (its primary core's), or of its first chunk
   * when it has no core. `used` is everything drawn so far.
   */
  energy(robotId: number): { stored: number; capacity: number; used: number } | undefined {
    const robot = this.byId.get(robotId);
    if (!robot) return undefined;
    const core = robot.primaryCoreId;
    const chunk = core === undefined ? 0 : chunkIndex(robot, core);
    return { ...poolTotals(poolContainers(robot, chunk)), used: this.used.get(robotId) ?? 0 };
  }

  /** The robot with this id, if it is still in the world. Read-only use outside the sim. */
  robotById(id: number): Robot | undefined {
    return this.byId.get(id);
  }

  /** The robot's controller, or undefined when it has no core. Read-only use outside the sim. */
  controller(robotId: number): Controller | undefined {
    return this.controllers.get(robotId);
  }

  canControl(robotId: number): boolean {
    return this.controllers.has(robotId);
  }

  /** A part's input channel value on the last tick, or undefined if the robot has no such part or channel. */
  channelValue(robotId: number, partId: string, channel: string): number | undefined {
    return this.channels.get(robotId)?.get(partId)?.get(channel);
  }

  /** Every channel value of a robot on the last tick. */
  robotChannels(robotId: number): ReadonlyMap<string, ReadonlyMap<string, number>> | undefined {
    return this.channels.get(robotId);
  }

  /** Hex hash of tick count, RNG state, and every body's exact state. */
  hash(): string {
    const h = new StateHasher();
    h.addInt(this.tickCount);
    for (const word of this.rng.state()) h.addInt(word);
    this.physics.hashInto(h);
    // Energy shapes the future: the sandbox switch and what every container holds.
    h.addInt(this.unlimited ? 1 : 0);
    for (const robot of this.robots) for (const part of robot.parts.values()) if (part.stored !== undefined) h.addF64(part.stored);
    // Which scripts run (and which crashed) shapes the future too.
    for (const [id, runner] of this.runners) {
      h.addInt(id);
      for (const sc of runner.scripts) {
        h.addString(sc.id);
        h.addInt(sc.enabled ? 1 : 0);
        h.addInt(sc.crashed ? 1 : 0);
      }
    }
    // Destruction (M6): which robots exist, what each part has left, cut faces, aims, frozen (latched) channels of
    // robots nobody controls, and blasts still waiting.
    h.addInt(this.nextRobotId);
    for (const robot of this.robots) {
      h.addInt(robot.id);
      // Team 0 adds nothing, so hashes from before teams (M8) still hold; any other team is marked, then its number.
      if (robot.team !== 0) {
        h.addString('team');
        h.addInt(robot.team);
      }
      h.addInt(robot.parts.size);
      for (const part of robot.parts.values()) {
        h.addString(part.id);
        h.addF64(part.health);
        h.addString((part.cut ?? []).join(''));
        h.addF64(part.aim ?? 0);
        // A sensor's power last tick decides what its scripts see next (M8). Other parts add nothing.
        if (part.sensing !== undefined) h.addInt(part.sensing ? 1 : 0);
        // Whether a part that needs arming is armed (M10). Other parts add nothing.
        if (part.armed !== undefined) h.addInt(part.armed ? 2 : 3);
        // A fabricator's grip, build, and count (M12). Other parts add nothing.
        if (part.def.fabricate !== undefined) {
          h.addInt(part.holding === true ? 1 : 0);
          h.addF64(part.progress ?? 0);
          h.addInt(part.built ?? 0);
          h.addString(part.holds ?? '');
        }
        // A gun's cooldown (M13). Other parts add nothing.
        if (part.def.gun !== undefined) h.addInt(part.cooldown ?? 0);
        // A decoy's burn left and the robot it stands in for (M11). Other parts add nothing.
        if (part.def.decoy !== undefined) {
          h.addInt(part.burn ?? -1);
          h.addInt(part.decoyOf ?? 0);
        }
        // Batch: a jammer pod's ticks left, and where its bubble is while it jams. Other parts add nothing.
        if (part.def.jammer !== undefined) {
          h.addInt(part.burn ?? -1);
          if ((part.burn ?? 0) > 0 && robot.groups[part.group]) {
            const pose = partWorldPose(this, robot, part.id);
            h.addF64(pose.x);
            h.addF64(pose.y);
          }
        }
        // Messages waiting for a core (M8) shape what its scripts do.
        for (const m of part.inbox ?? []) {
          h.addString(m.from);
          h.addInt(m.tick);
          h.addString(m.data);
        }
      }
      if (this.controllers.has(robot.id)) continue;
      for (const [id, chans] of this.channels.get(robot.id) ?? []) {
        h.addString(id);
        for (const [name, v] of chans) {
          h.addString(name);
          h.addF64(v);
        }
      }
    }
    h.addInt(this.queuedBlasts.length);
    for (const b of this.queuedBlasts) {
      h.addInt(b.robot);
      h.addF64(b.x);
      h.addF64(b.y);
      for (const v of [b.spec.radius, b.spec.damage, b.spec.pushRadius, b.spec.push, b.spec.lift]) h.addF64(v);
    }
    // Kicks and pushes waiting for the next step.
    h.addInt(this.pendingKicks.size);
    for (const [body, k] of this.pendingKicks) {
      h.addInt(body);
      h.addF64(k.vx);
      h.addF64(k.vy);
      h.addF64(k.w);
    }
    h.addInt(this.pendingPushes.length);
    for (const p of this.pendingPushes) {
      h.addString(p.part.id);
      h.addF64(p.jx);
      h.addF64(p.jy);
      if (p.quiet) h.addInt(1);
    }
    // Batch: bays waiting on loose pieces. None adds nothing, so worlds without a blocked bay hash as before.
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        const since = this.clearing.get(part);
        if (since === undefined) continue;
        h.addString('clearing');
        h.addString(part.id);
        h.addInt(since);
      }
    }
    // Batch: how long each broken-off piece has rested decides when it fades. None adds nothing.
    if (this.debrisRest.size > 0) {
      h.addString('debris');
      for (const [id, n] of this.debrisRest) {
        h.addInt(id);
        h.addInt(n);
      }
    }
    // Shells in flight (M13). None adds nothing, so worlds without guns hash as before.
    if (this.shells.length > 0) {
      h.addString('shells');
      h.addInt(this.shells.length);
      for (const sh of this.shells) {
        for (const v of [sh.x, sh.y, sh.vx, sh.vy, sh.damage, sh.push]) h.addF64(v);
        h.addInt(sh.robot);
        h.addString(sh.gun);
        h.addInt(sh.left);
      }
    }
    // Smoke clouds (Batch). None adds nothing, so worlds without smoke hash as before.
    if (this.clouds.length > 0) {
      h.addString('smoke');
      h.addInt(this.clouds.length);
      for (const c of this.clouds) {
        for (const v of [c.x, c.y, c.radius]) h.addF64(v);
        h.addInt(c.left);
        h.addInt(c.total);
      }
    }
    // Grapple ropes (Batch). None adds nothing, so worlds without grapples hash as before.
    this.grapples.hashInto(h, this.gh());
    // Held keys and toggles shape the future, so they are state too.
    for (const [id, c] of this.controllers) {
      const st = c.state();
      h.addInt(id);
      h.addInt(st.held.length);
      for (const k of st.held) h.addString(k);
      h.addInt(st.toggles.length);
      for (const t of st.toggles) h.addInt(t);
    }
    return StateHasher.hex(h.digest());
  }

  dispose(): void {
    for (const r of this.runners.values()) r.dispose();
    this.physics.free();
  }
}

/** The frozen channel values of the robot's own parts, copied out of a parent's (latching, `04`). */
function latchedFor(values: ReadonlyMap<string, ReadonlyMap<string, number>>, robot: Robot): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const id of robot.parts.keys()) {
    const v = values.get(id);
    if (v) out.set(id, new Map(v));
  }
  return out;
}

/**
 * The bindings and scripts a robot's active core runs: the top-level ones, or for a core that woke in a piece that
 * broke off, its own entry in `cores` (M7; none when it has no entry). For the UI: the keys bar's script keys.
 */
export function activeControls(robot: Robot): { bindings: readonly Binding[]; scripts: readonly ScriptSpec[] } {
  if (!robot.woke) return { bindings: robot.blueprint.bindings, scripts: robot.blueprint.scripts };
  const own = coreControls(robot);
  return { bindings: own?.bindings ?? [], scripts: own?.scripts ?? [] };
}

/**
 * The controls a woken core runs (M7): its entry in the blueprint's `cores`, if it has one. The robot's own primary
 * core (not woken) runs the top-level controls instead.
 */
function coreControls(robot: Robot): CoreControls | undefined {
  if (!robot.woke || robot.primaryCoreId === undefined) return undefined;
  return robot.blueprint.cores?.find((c) => c.core === robot.primaryCoreId);
}

/**
 * The controlled chunk is the one holding the primary core; tags resolve inside it only (`04`). A core that woke in a
 * piece that broke off runs its own controls from `cores` (a placed missile's, seen through its scope), plus auto
 * controls for the piece's parts; without an entry, auto controls only.
 */
function controllerFor(robot: Robot, registry: PartRegistry): Controller | undefined {
  const coreId = robot.primaryCoreId;
  if (coreId === undefined) return undefined;
  const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
  if (!chunk) return undefined;
  const own = coreControls(robot);
  const parts: ControlledPart[] = [];
  for (const id of chunk.partIds) {
    const p = robot.parts.get(id);
    if (!p) continue;
    const view = scopedView({ id, part: p.def.id, tags: p.tags }, own?.scope);
    parts.push({ id, part: view.part, tags: view.tags, inputs: p.def.inputs });
  }
  if (!robot.woke) return new Controller(allBindings(robot.blueprint, registry), parts);
  const pieceBp: Blueprint = { ...robot.blueprint, parts: robot.blueprint.parts.filter((p) => robot.parts.has(p.id)) };
  if (!own) return new Controller(autoBindings(pieceBp, registry), parts);
  // The core's own switch decides, not the robot it came from.
  const { autoControls: _parent, ...rest } = pieceBp;
  const auto = own.autoControls === false ? [] : autoBindings(rest, registry);
  return new Controller([...auto, ...own.bindings], parts);
}

/**
 * `energy` and `partOutput` as they were before M9, kept verbatim for the parity test's reference input
 * (`scriptInput`), so a mistake in the faster versions cannot hide on both sides of the comparison.
 */
function referenceChunkIndex(robot: Robot, partId: string): number {
  return Math.max(0, robot.chunks.findIndex((c) => c.partIds.includes(partId)));
}

function referenceEnergy(robot: Robot): { stored: number; capacity: number } {
  const core = robot.primaryCoreId;
  const chunk = core === undefined ? 0 : referenceChunkIndex(robot, core);
  return poolTotals(poolContainers(robot, chunk));
}

function referenceOutput(robot: Robot, part: PartInstance, partId: string, name: string): number | undefined {
  if (!part.def.outputs.some((o) => o.name === name)) return undefined;
  const own = part.def.behavior === undefined ? undefined : BEHAVIORS.get(part.def.behavior)?.output?.(part, name);
  if (own !== undefined) return own;
  if (name === 'charge') return part.stored !== undefined && part.def.resource ? part.stored / part.def.resource.capacity : undefined;
  if (name === 'energy' || name === 'energyCapacity') {
    const pool = poolTotals(poolContainers(robot, referenceChunkIndex(robot, partId)));
    return name === 'energy' ? pool.stored : pool.capacity;
  }
  if (name === 'armed' && part.armed !== undefined) return part.armed ? 1 : 0;
  if (name === 'burning' && part.def.decoy !== undefined) return (part.burn ?? 0) > 0 ? 1 : 0;
  if (name === 'jamming' && part.def.jammer !== undefined) return (part.burn ?? 0) > 0 ? 1 : 0;
  if (part.def.gun !== undefined) {
    if (name === 'sight') return part.sight?.distance ?? part.def.gun.range;
    if (name === 'sightSide') return part.sight?.side ?? 0;
    if (name === 'sightId') return part.sight?.id ?? 0;
    if (name === 'aim') return part.sight?.aim ?? 0;
  }
  // Batch: the reference has no ropes; a grapple with none reads 0 and 0.
  if (part.def.grapple !== undefined && (name === 'hooked' || name === 'length')) return 0;
  return undefined;
}

/**
 * A number in [0, 1) that depends only on its inputs (M13: shell spread). A hash, not a random stream: nothing to
 * keep or hash, and adding a gun changes nothing else's numbers. FNV-1a over the inputs, then a final mix.
 */
function noise(seed: number, tick: number, robot: number, key: string, n: number): number {
  let h = 2166136261;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v & 0xffff), 16777619);
    h = Math.imul(h ^ (v >>> 16), 16777619);
  };
  mix(seed | 0);
  mix(tick | 0);
  mix(robot | 0);
  mix(n | 0);
  for (let i = 0; i < key.length; i++) mix(key.charCodeAt(i));
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A gun's outputs (M13): its sight after the last step; before it first looks, nothing seen within its range. */
function gunOutput(part: PartInstance, name: string): number | undefined {
  const range = part.def.gun?.range ?? 0;
  if (name === 'sight') return part.sight?.distance ?? range;
  if (name === 'sightSide') return part.sight?.side ?? SIGHT.nothing;
  if (name === 'sightId') return part.sight?.id ?? 0;
  if (name === 'aim') return part.sight?.aim ?? 0;
  return undefined;
}

/** Each robot's part-to-chunk map, rebuilt when the robot is (its `version` changes). */
const chunkMaps = new WeakMap<Robot, { version: number; chunks: Robot['chunks']; of: Map<string, number> }>();

/** Index of the chunk holding the part (every part is in exactly one; 0 when none holds it). */
function chunkIndex(robot: Robot, partId: string): number {
  let m = chunkMaps.get(robot);
  if (!m || m.version !== robot.version || m.chunks !== robot.chunks) {
    const of = new Map<string, number>();
    robot.chunks.forEach((c, i) => {
      for (const id of c.partIds) if (!of.has(id)) of.set(id, i);
    });
    m = { version: robot.version, chunks: robot.chunks, of };
    chunkMaps.set(robot, m);
  }
  return m.of.get(partId) ?? 0;
}

/** The energy containers of one chunk, as pool entries (copies; the caller writes `stored` back). */
function poolContainers(robot: Robot, chunk: number): Container[] {
  const out: Container[] = [];
  for (const id of robot.chunks[chunk]?.partIds ?? []) {
    const p = robot.parts.get(id);
    if (p?.stored !== undefined && p.def.resource?.kind === 'energy') out.push({ id, stored: p.stored, capacity: p.def.resource.capacity });
  }
  return out;
}
