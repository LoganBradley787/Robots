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
import type { ScriptError, ScriptHost, ScriptInput } from '../script/types';
import { partWorldPose } from '../metrics/robotMetrics';
import { buildWorld, type WorldFile } from './WorldFile';
import { defaultRegistry, type PartRegistry } from '../parts/registry';
import { loadBlueprint, validateBlueprint } from '../blueprint/validate';
import { spawnRobot } from '../assembly/spawn';
import { partCells, rootPartId } from '../assembly/assemble';
import { rebuildRobot, type BodyMotion } from '../assembly/rebuild';
import { blastEffects, type BlastCell } from '../damage/explosion';
import { faceDir, rotateCell } from '../parts/faces';
import type { ExplodeSpec, Face } from '../parts/types';
import type { PartInstance, Robot } from './Robot';

export interface SpawnRecord {
  tick: number;
  name: string;
  at: { x: number; y: number };
  /** The raw blueprint as passed in. */
  blueprint: unknown;
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
  /** Pushes (N s) to apply to parts at the end of the damage phase, once every rebuild is done. */
  private pendingPushes: { part: PartInstance; jx: number; jy: number }[] = [];
  /** Velocities given to new bodies this tick, applied as kicks at the end of the damage phase. */
  private readonly pendingKicks = new Map<BodyId, { vx: number; vy: number; w: number }>();
  /**
   * Bodies whose velocity jumps for a reason other than a hit (a kick after a rebuild, a blast push), by the last tick
   * the impact check ignores them. Not hashed: it is derived from what happened on recent ticks.
   */
  private readonly unsettled = new Map<BodyId, number>();
  private readonly gravityY: number;

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
  spawnBlueprint(raw: unknown, at: { x: number; y: number }): Robot {
    const { blueprint, plan } = loadBlueprint(raw, this.registry);
    const robot = spawnRobot(this.physics, this.registry, blueprint, plan, { id: this.nextRobotId++, tick: this.tickCount, at });
    this.robots.push(robot);
    const controller = controllerFor(robot, this.registry);
    if (controller) {
      this.controllers.set(robot.id, controller);
      this.channels.set(robot.id, controller.values());
      if (robot.blueprint.scripts.length > 0) {
        // Each script gets its own random stream from the world seed, the robot, and its place in the list.
        const seed = (i: number): number => (Math.imul(this.seed ^ 0x9e3779b9, 31) + Math.imul(robot.id, 65537) + i * 7919) >>> 0;
        this.runners.set(robot.id, new ScriptRunner(robot.blueprint.scripts, this.scriptHost, seed));
      }
    }
    this.spawnLog.push({ tick: this.tickCount, name: robot.name, at: { x: at.x, y: at.y }, blueprint: raw });
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
    if (this.dirty.size > 0) {
      this.rebuildDirty();
      this.applyPendingForces();
    }
    this.runBehaviors(false);
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
    this.applyPendingForces();
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
          forget: (body) => this.pendingKicks.delete(body),
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
          this.events.push({ tick: this.tickCount, robot: piece.id, kind: 'coreWoke', from: robot.id });
        } else {
          this.channels.set(piece.id, latchedFor(latched, piece));
        }
      }
      if (pieces.length > 1) this.events.push({ tick: this.tickCount, robot: robot.id, kind: 'split', pieces: pieces.slice(1).map((p) => p.id) });
    }
  }

  /** A body's pose and motion, counting a kick given earlier this tick. */
  private motion(body: BodyId): BodyMotion {
    const s = this.physics.state(body);
    const mp = this.physics.massProperties(body);
    const k = this.pendingKicks.get(body);
    return { x: s.x, y: s.y, angle: s.angle, vx: k?.vx ?? s.vx, vy: k?.vy ?? s.vy, w: k?.w ?? s.w, comX: mp.comX, comY: mp.comY };
  }

  /** One blast: damage and push every part cell of every robot near it (`damage/explosion`). Terrain is immune. */
  private applyBlast(b: QueuedBlast): void {
    const reach = Math.max(b.spec.radius, b.spec.pushRadius) + 1;
    const targets: PartInstance[] = [];
    const cells: BlastCell[] = [];
    for (const robot of this.robots) {
      for (const part of robot.parts.values()) {
        const pose = partWorldPose(this, robot, part.id);
        if ((pose.x - b.x) ** 2 + (pose.y - b.y) ** 2 > reach * reach) continue;
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

  /** Kicks for new bodies, then pushes at each surviving part's cell, all as forces for the next step. */
  private applyPendingForces(): void {
    // A kicked link reports its velocity a step late, so its velocity jumps on each of the next two steps.
    for (const [body, k] of this.pendingKicks) {
      this.physics.kick(body, k.vx, k.vy, k.w);
      this.unsettled.set(body, this.tickCount + 2);
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
      this.unsettled.set(group.bodyId, Math.max(this.unsettled.get(group.bodyId) ?? 0, this.tickCount + 1));
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
    const neighbor = [...robot.parts.values()].find((p) => p !== part && cellsOf(p).some((c) => across.has(`${c.x},${c.y}`)));
    const s = this.physics.state(robot.groups[part.group]?.bodyId ?? 0);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const nx = c * d.x - n * d.y;
    const ny = n * d.x + c * d.y;
    this.pendingPushes.push({ part, jx: -nx * impulse, jy: -ny * impulse });
    if (neighbor) this.pendingPushes.push({ part: neighbor, jx: nx * impulse, jy: ny * impulse });
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
      const out = runner.tick(() => this.scriptInput(robot, controller.keyState()));
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
      parts.push({ id, type: p.def.id, tags: p.tags, pos: { x: pose.x, y: pose.y }, angle: pose.angle, in: Object.fromEntries(chans?.get(id) ?? []), out });
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
    };
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
      h.addInt(robot.parts.size);
      for (const part of robot.parts.values()) {
        h.addString(part.id);
        h.addF64(part.health);
        h.addString((part.cut ?? []).join(''));
        h.addF64(part.aim ?? 0);
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
      h.addF64(b.x);
      h.addF64(b.y);
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
 * The controlled chunk is the one holding the primary core; tags resolve inside it only (`04`). A core that woke in a
 * piece that broke off gets its parts' auto controls: bindings and scripts belong to the primary core until
 * sub-assemblies (M7) give sub-assembly cores their own.
 */
function controllerFor(robot: Robot, registry: PartRegistry): Controller | undefined {
  const coreId = robot.primaryCoreId;
  if (coreId === undefined) return undefined;
  const chunk = robot.chunks.find((c) => c.partIds.includes(coreId));
  if (!chunk) return undefined;
  const parts: ControlledPart[] = [];
  for (const id of chunk.partIds) {
    const p = robot.parts.get(id);
    if (p) parts.push({ id, part: p.def.id, tags: p.tags, inputs: p.def.inputs });
  }
  const bindings = robot.woke ? autoBindings({ ...robot.blueprint, parts: robot.blueprint.parts.filter((p) => robot.parts.has(p.id)) }, registry) : allBindings(robot.blueprint, registry);
  return new Controller(bindings, parts);
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
