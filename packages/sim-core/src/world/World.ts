import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type ShapeSpec } from '../physics/PhysicsWorld';
import { Prng } from '../rng/Prng';
import { StateHasher } from '../replay/StateHasher';
import { InputLog } from '../replay/InputLog';
import { Controller } from '../control/controller';
import type { ControlledPart, RobotInput } from '../control/types';
import { BEHAVIORS, type BehaviorContext } from '../behaviors/registry';
import { allBindings } from '../control/autoControls';
import { drainContainers, grantFactor, poolTotals, type Container } from '../resources/pools';
import type { PlannedAction } from '../behaviors/registry';
import { buildWorld, type WorldFile } from './WorldFile';
import { defaultRegistry, type PartRegistry } from '../parts/registry';
import { loadBlueprint, validateBlueprint } from '../blueprint/validate';
import { spawnRobot } from '../assembly/spawn';
import { partCells, rootPartId } from '../assembly/assemble';
import type { Robot } from './Robot';

export interface SpawnRecord {
  tick: number;
  name: string;
  at: { x: number; y: number };
  /** The raw blueprint as passed in. */
  blueprint: unknown;
}

/** Something that happened in the sim, for the UI and reports. Not part of the state hash. */
export interface WorldEvent {
  tick: number;
  robot: number;
  kind: 'energyEmpty';
  /** Index of the chunk whose pool ran dry. */
  chunk: number;
}

export interface WorldOptions {
  seed: number;
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
  /** Pools that have already reported running dry, by `robot:chunk`. */
  private readonly emptied = new Set<string>();
  /** Energy drawn so far, per robot. Reporting only. */
  private readonly used = new Map<number, number>();
  /** Final channel values from the last tick, per robot, for behaviors, render, and UI. */
  private readonly channels = new Map<number, Map<string, Map<string, number>>>();

  private constructor(opts: WorldOptions, file: WorldFile, registry: PartRegistry) {
    this.registry = registry;
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.rng = new Prng(opts.seed);
    this.physics = new PhysicsWorld(opts.gravityY ?? -9.81, this.dt);
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
   * steps physics. Robots without inputs keep their held keys and toggles. An input for a robot that does not
   * exist or cannot be controlled is a caller bug and throws before anything changes.
   */
  step(inputs: readonly RobotInput[] = []): void {
    for (const input of inputs) {
      if (!this.controllers.has(input.robot)) throw new Error(`robot ${input.robot} does not exist or has no core to control`);
    }
    const change = this.pendingUnlimited === undefined ? undefined : { unlimitedEnergy: this.pendingUnlimited };
    if (this.pendingUnlimited !== undefined) this.unlimited = this.pendingUnlimited;
    this.pendingUnlimited = undefined;
    this.inputLog.append(this.tickCount, inputs, change);
    for (const input of inputs) this.controllers.get(input.robot)?.apply(input.pressed, input.released);
    for (const [id, c] of this.controllers) this.channels.set(id, c.values());
    this.runBehaviors();
    this.physics.step();
    for (const c of this.controllers.values()) c.endTick();
    this.tickCount++;
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
   * brownout), then every action runs with its grant. Robots in spawn order, parts in blueprint order.
   */
  private runBehaviors(): void {
    for (const robot of this.robots) {
      const planned: { action: PlannedAction; chunk: number; request: number }[] = [];
      const chans = this.channels.get(robot.id);
      for (const part of robot.parts.values()) {
        const behavior = part.def.behavior === undefined ? undefined : BEHAVIORS.get(part.def.behavior);
        const group = robot.groups[part.group];
        if (!behavior || !group) continue;
        const own = chans?.get(part.id);
        const ctx: BehaviorContext = {
          physics: this.physics,
          robot,
          part,
          group,
          dt: this.dt,
          value: (channel) => own?.get(channel) ?? part.def.inputs.find((c) => c.name === channel)?.default ?? 0,
          config: (key) => part.def.behaviorConfig?.[key] ?? 0,
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
    this.physics.free();
  }
}

/** The controlled chunk is the one holding the primary core; tags resolve inside it only (`04`). */
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
  return new Controller(allBindings(robot.blueprint, registry), parts);
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
