import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type BodyId, type ShapeSpec } from '../physics/PhysicsWorld';
import { Prng } from '../rng/Prng';
import { StateHasher } from '../replay/StateHasher';
import { InputLog, type WorldChange } from '../replay/InputLog';
import { Controller } from '../control/controller';
import type { ControlledPart, RobotInput } from '../control/types';
import { BEHAVIORS, type BehaviorContext } from '../behaviors/registry';
import { allBindings, autoBindings } from '../control/autoControls';
import { drainContainers, grantFactor, poolTotals, type Container } from '../resources/pools';
import type { PlannedAction } from '../behaviors/registry';
import { ScriptRunner } from '../script/runner';
import type { ScannedPart, ScriptContact, ScriptError, ScriptHost, ScriptInput, ScriptMark, ScriptServices } from '../script/types';
import { sees, type SensorPose } from '../sensors/sight';
import type { TerrainBox } from '../physics/PhysicsWorld';
import { partWorldPose } from '../metrics/robotMetrics';
import { buildWorld, type WorldFile } from './WorldFile';
import { defaultRegistry, type PartRegistry } from '../parts/registry';
import { loadBlueprint, validateBlueprint } from '../blueprint/validate';
import { spawnRobot } from '../assembly/spawn';
import { partCells, rootPartId } from '../assembly/assemble';
import { rebuildRobot, type BodyMotion } from '../assembly/rebuild';
import { blastEffects, type BlastCell } from '../damage/explosion';
import { faceDir, opposite, rotateCell, rotateFace } from '../parts/faces';
import type { ExplodeSpec, Face } from '../parts/types';
import type { PartInstance, Robot } from './Robot';
import type { Binding, Blueprint, CoreControls, ScriptSpec } from '../blueprint/types';
import { scopedView } from '../control/target';

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
  /** A part reached 0 health and is gone. `x`, `y` is where its cell was. */
  | { tick: number; robot: number; kind: 'partDestroyed'; part: string; partType: string; x: number; y: number }
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
  | { tick: number; robot: number; kind: 'removed' };

/** Blasts resolved per tick at most (`03`); the rest wait for the next tick. */
export const MAX_BLASTS_PER_TICK = 100;

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
  /** Scripts per robot, on robots with a core. */
  private readonly runners = new Map<number, ScriptRunner>();
  /** Recent `log()` lines from scripts, oldest first (at most LOG_KEEP). */
  readonly scriptLogs: ScriptLog[] = [];
  /** Log lines per robot in the current second, for rate limiting. */
  private readonly logBudget = new Map<number, { second: number; count: number }>();
  /** Pools that have already reported running dry, by `robot:chunk`. */
  private readonly emptied = new Set<string>();
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
  /** Blasts waiting because the per-tick cap was reached. Simulation state, hashed. */
  private queuedBlasts: QueuedBlast[] = [];
  /**
   * Pushes (N s) waiting for the next physics step, by part: they land on whatever body holds the part by then, so a
   * robot rebuilt again before the step keeps them. Simulation state, hashed.
   */
  private pendingPushes: { part: PartInstance; jx: number; jy: number }[] = [];
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
  /** Fixed terrain boxes, read once: they never change after the world is built. */
  private terrain: TerrainBox[] | undefined;
  /** Robots each robot's sensors saw when its scripts last ran, for `scan()` (M8). Derived, not hashed. */
  private readonly seen = new Map<number, Set<number>>();
  /** The marks each robot's scripts made when they last ran, by script (M8). For the overlay and reports; not hashed. */
  private readonly scriptMarks = new Map<number, { script: string; marks: ScriptMark[] }[]>();

  private constructor(opts: WorldOptions, file: WorldFile, registry: PartRegistry) {
    this.registry = registry;
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.scriptHost = opts.scripts;
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
    const controller = controllerFor(robot, this.registry);
    if (controller) {
      this.controllers.set(robot.id, controller);
      this.channels.set(robot.id, controller.values());
      this.startScripts(robot, robot.blueprint.scripts);
    }
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
    const change: WorldChange = {};
    if (this.pendingUnlimited !== undefined) change.unlimitedEnergy = this.pendingUnlimited;
    if (this.pendingClearDebris) change.clearDebris = true;
    if (this.pendingUnlimited !== undefined) this.unlimited = this.pendingUnlimited;
    this.pendingUnlimited = undefined;
    if (this.pendingClearDebris) this.removeDebris();
    this.pendingClearDebris = false;
    this.inputLog.append(this.tickCount, accepted, Object.keys(change).length > 0 ? change : undefined);
    for (const input of accepted) this.controllers.get(input.robot)?.apply(input.pressed, input.released);
    this.runScripts();
    for (const [id, c] of this.controllers) this.channels.set(id, c.values());
    // Structure first (a decoupler firing), so the pieces exist before anything pushes on this tick.
    this.runBehaviors(true);
    if (this.dirty.size > 0) this.rebuildDirty();
    this.runBehaviors(false);
    this.applyPendingForces();
    this.physics.step();
    this.damagePhase();
    for (const c of this.controllers.values()) c.endTick();
    this.tickCount++;
  }

  /** Removes every robot nobody can control (debris, headless robots, bombs) on the next tick, logged for replays. */
  clearDebris(): void {
    this.pendingClearDebris = true;
  }

  private removeDebris(): void {
    for (const robot of [...this.robots]) if (!this.controllers.has(robot.id)) this.removeRobot(robot);
  }

  private removeRobot(robot: Robot): void {
    for (const g of robot.groups) {
      this.pendingKicks.delete(g.bodyId);
      this.lastKicks.delete(g.bodyId);
      this.physics.removeBody(g.bodyId);
    }
    robot.groups = [];
    const i = this.robots.indexOf(robot);
    if (i >= 0) this.robots.splice(i, 1);
    this.controllers.delete(robot.id);
    this.channels.delete(robot.id);
    this.runners.get(robot.id)?.dispose();
    this.runners.delete(robot.id);
    this.dirty.delete(robot);
    this.used.delete(robot.id);
    this.logBudget.delete(robot.id);
    this.seen.delete(robot.id);
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
   */
  private checkImpacts(): void {
    for (const [body, until] of this.unsettled) if (until < this.tickCount) this.unsettled.delete(body);
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        const group = robot.groups[part.group];
        if (!part.def.impact || !group || this.unsettled.has(group.bodyId)) continue;
        const s = this.physics.state(group.bodyId);
        const p = this.physics.prevState(group.bodyId);
        const dvx = s.vx - p.vx;
        const dvy = s.vy - p.vy - this.gravityY * this.dt;
        if (Math.sqrt(dvx * dvx + dvy * dvy) > part.def.impact.speed) part.health = 0;
      }
    }
  }

  /** Removes every part at 0 health (robots in order, parts in blueprint order) and queues its blast if it has one. */
  private destroyDeadParts(): void {
    for (const robot of this.robots) {
      for (const bp of robot.blueprint.parts) {
        const part = robot.parts.get(bp.id);
        if (!part || part.health > 0) continue;
        const pose = partWorldPose(this, robot, part.id);
        robot.parts.delete(part.id);
        this.dirty.add(robot);
        this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'partDestroyed', part: part.id, partType: part.def.id, x: pose.x, y: pose.y });
        const explode = part.def.onDestroyed?.explode;
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
    for (const robot of [...this.robots]) {
      if (!this.dirty.has(robot)) continue;
      this.dirty.delete(robot);
      const controller = this.controllers.get(robot.id);
      const latched = controller ? controller.values(true) : (this.channels.get(robot.id) ?? new Map<string, Map<string, number>>());
      const pieces = rebuildRobot(
        {
          physics: this.physics,
          registry: this.registry,
          tick: this.tickCount,
          motion: (body) => this.motion(body),
          kick: (body, vx, vy, w) => this.pendingKicks.set(body, { vx, vy, w }),
          forget: (body) => {
            this.pendingKicks.delete(body);
            this.lastKicks.delete(body);
          },
          newRobotId: () => this.nextRobotId++,
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
      } else if (controller) {
        controller.restrict(new Set(robot.parts.keys()));
        this.channels.set(robot.id, latchedFor(controller.values(), robot));
      } else {
        this.channels.set(robot.id, latchedFor(latched, robot));
      }
      for (const piece of pieces.slice(1)) {
        this.robots.push(piece);
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
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        // Destroyed by an earlier blast in this batch: gone, so it neither takes damage nor covers anything.
        if (part.health <= 0) continue;
        const pose = partWorldPose(this, robot, part.id);
        const dx = pose.x - b.x;
        const dy = pose.y - b.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        targets.push(part);
        cells.push(pose);
      }
    }
    const fx = blastEffects({ x: b.x, y: b.y }, b.spec, cells, this.physics.terrainBoxes());
    targets.forEach((part, i) => {
      const damage = fx.damage[i] ?? 0;
      const push = fx.push[i];
      if (damage > 0) part.health -= damage;
      if (push && (push.jx !== 0 || push.jy !== 0)) this.pendingPushes.push({ part, jx: push.jx, jy: push.jy });
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
      for (const g of robot.groups) settle(g.bodyId);
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
      p.def.footprint.map((fc) => {
        const off = rotateCell(fc, p.rot);
        return { x: p.x + off.x, y: p.y + off.y };
      });
    const across = new Set(cellsOf(part).map((c) => `${c.x + d.x},${c.y + d.y}`));
    // Only a part that was attached through that face (it has the opposite face there) is pushed away.
    const back = opposite(face);
    const neighbor = [...robot.parts.values()].find(
      (p) => p !== part && p.def.footprint.some((fc) => {
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

  /**
   * Scripts run after key edges and before channels are final (`04`): they see this tick's keys and last tick's
   * channel values, and write the script layer. A crash disables only that script; the world keeps stepping.
   */
  private runScripts(): void {
    for (const [robotId, runner] of this.runners) {
      const controller = this.controllers.get(robotId);
      const robot = this.robots.find((r) => r.id === robotId);
      if (!controller || !robot) continue;
      for (const id of controller.takeScriptToggles()) runner.toggle(id);
      const services: ScriptServices = { scan: (id) => this.scan(robot, id), send: (to, json) => this.send(robot, to, json) };
      const out = runner.tick(() => this.scriptInput(robot, controller.keyState()), services);
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

  /** What a robot's scripts see this tick (`04`, Script API): exact data about its core and its parts. */
  private scriptInput(robot: Robot, keys: ScriptInput['keys']): ScriptInput {
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const core = partWorldPose(this, robot, coreId);
    const coreBody = robot.groups[robot.parts.get(coreId)?.group ?? 0]?.bodyId ?? 0;
    const s = this.physics.state(coreBody);
    let mass = 0;
    for (const g of robot.groups) mass += this.physics.massProperties(g.bodyId).mass;
    const energy = this.energy(robot.id);
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
        const v = this.partOutput(robot.id, id, o.name);
        if (v !== undefined) out[o.name] = v;
      }
      parts.push({ id, type: p.def.id, tags: [...scopedView({ id, part: p.def.id, tags: p.tags }, scope).tags], pos: { x: pose.x, y: pose.y }, angle: pose.angle, mass: p.def.mass, in: Object.fromEntries(chans?.get(id) ?? []), out });
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
   * by its scope as the sender sees it (`missile1`) or by part id. Its scripts see it from the next tick. No radio yet:
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
      return id === to || robot.blueprint.cores?.some((c) => c.core === id && c.scope === wanted) === true;
    });
    const part = target === undefined ? undefined : robot.parts.get(target);
    if (!part) return false;
    part.inbox = [...(part.inbox ?? []), { from: own, tick: this.tickCount, data: json }].slice(-16);
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
    const coreId = robot.primaryCoreId;
    if (coreId === undefined || !this.controllers.has(robot.id)) return [];
    const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
    const out: SensorPose[] = [];
    for (const id of chunk?.partIds ?? []) {
      const p = robot.parts.get(id);
      const spec = p?.def.sensor;
      if (!p || !spec || p.sensing === false) continue;
      const pose = partWorldPose(this, robot, id);
      const d = faceDir(rotateFace(p.def.acts ?? 'N', p.rot));
      out.push({ id, x: pose.x, y: pose.y, facing: pose.angle + Math.atan2(d.y, d.x), cone: spec.cone, range: spec.range });
    }
    return out;
  }

  /** Where a robot is for sensors: its live core, else its center of mass; with its mass and center either way. */
  private reference(r: Robot): { core: boolean; pos: { x: number; y: number }; vel: { x: number; y: number }; center: { x: number; y: number }; mass: number } {
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
   * this tick; the overlay's read-only view does not.
   */
  private contactsFor(robot: Robot, remember: boolean): ScriptContact[] {
    const sensors = this.workingSensors(robot);
    if (remember) this.seen.delete(robot.id);
    if (sensors.length === 0) return [];
    const terrain = this.terrainBoxes();
    const coreId = robot.primaryCoreId ?? robot.rootId;
    const from = partWorldPose(this, robot, coreId);
    const out: ScriptContact[] = [];
    for (const other of this.robots) {
      if (other === robot || other.groups.length === 0) continue;
      const ref = this.reference(other);
      const by = sensors.filter((s) => sees(s, ref.pos, terrain)).map((s) => s.id);
      if (by.length === 0) continue;
      const side = !this.controllers.has(other.id) ? 'none' : other.team === robot.team ? 'friend' : 'enemy';
      out.push({ id: other.id, side, core: ref.core, pos: ref.pos, vel: ref.vel, center: ref.center, mass: ref.mass, parts: other.parts.size, distance: Math.hypot(ref.pos.x - from.x, ref.pos.y - from.y), by });
    }
    out.sort((a, b) => a.distance - b.distance || a.id - b.id);
    if (remember) this.seen.set(robot.id, new Set(out.map((c) => c.id)));
    return out;
  }

  /** `scan(id)` (M8): a robot the viewer's sensors saw this tick, part by part, in blueprint order; null otherwise. */
  private scan(viewer: Robot, id: number): ScannedPart[] | null {
    if (!this.seen.get(viewer.id)?.has(id)) return null;
    const r = this.robots.find((x) => x.id === id);
    if (!r) return null;
    const out: ScannedPart[] = [];
    for (const bp of r.blueprint.parts) {
      const p = r.parts.get(bp.id);
      if (!p) continue;
      const pose = partWorldPose(this, r, p.id);
      out.push({ id: p.id, type: p.def.id, pos: { x: pose.x, y: pose.y }, angle: pose.angle, health: p.health, maxHealth: p.def.health });
    }
    return out;
  }

  /**
   * What a robot's sensors see now, for the debug overlay (M8): each working sensor and each contact. Read-only; the
   * same rule scripts get.
   */
  sensorView(robotId: number): { sensors: SensorPose[]; contacts: { id: number; side: ScriptContact['side']; x: number; y: number }[] } {
    const robot = this.robots.find((r) => r.id === robotId);
    if (!robot) return { sensors: [], contacts: [] };
    return { sensors: this.workingSensors(robot), contacts: this.contactsFor(robot, false).map((c) => ({ id: c.id, side: c.side, x: c.pos.x, y: c.pos.y })) };
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
    const robot = this.robots.find((r) => r.id === robotId);
    const part = robot?.parts.get(partId);
    if (!robot || !part || !part.def.outputs.some((o) => o.name === name)) return undefined;
    const own = part.def.behavior === undefined ? undefined : BEHAVIORS.get(part.def.behavior)?.output?.(part, name);
    if (own !== undefined) return own;
    if (name === 'charge') return part.stored !== undefined && part.def.resource ? part.stored / part.def.resource.capacity : undefined;
    if (name === 'energy' || name === 'energyCapacity') {
      const pool = poolTotals(poolContainers(robot, chunkIndex(robot, partId)));
      return name === 'energy' ? pool.stored : pool.capacity;
    }
    return undefined;
  }

  /**
   * A robot's energy: the pool of the chunk it is controlled through (its primary core's), or of its first chunk
   * when it has no core. `used` is everything drawn so far.
   */
  energy(robotId: number): { stored: number; capacity: number; used: number } | undefined {
    const robot = this.robots.find((r) => r.id === robotId);
    if (!robot) return undefined;
    const core = robot.primaryCoreId;
    const chunk = core === undefined ? 0 : Math.max(0, robot.chunks.findIndex((c) => c.partIds.includes(core)));
    return { ...poolTotals(poolContainers(robot, chunk)), used: this.used.get(robotId) ?? 0 };
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
    }
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

/** Index of the chunk holding the part (every part is in exactly one). */
function chunkIndex(robot: Robot, partId: string): number {
  return Math.max(0, robot.chunks.findIndex((c) => c.partIds.includes(partId)));
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
