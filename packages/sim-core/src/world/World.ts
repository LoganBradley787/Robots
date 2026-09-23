import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type BodyId } from '../physics/PhysicsWorld';
import { Prng } from '../rng/Prng';
import { StateHasher } from '../replay/StateHasher';
import { InputLog, type InputFrame } from '../replay/InputLog';
import { buildWorld, type WorldFile } from './WorldFile';

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
  private tickCount = 0;

  private constructor(opts: WorldOptions, file: WorldFile) {
    this.dt = opts.dt ?? 1 / 60;
    this.seed = opts.seed;
    this.rng = new Prng(opts.seed);
    this.physics = new PhysicsWorld(opts.gravityY ?? -9.81, this.dt);
    this.file = file;
    buildWorld(this.physics, file);
  }

  /** The only way to make a World: guarantees the Rapier WASM is loaded first. */
  static async create(opts: WorldOptions, file: WorldFile): Promise<World> {
    await loadRapier();
    return new World(opts, file);
  }

  get tick(): number {
    return this.tickCount;
  }

  get time(): number {
    return this.tickCount * this.dt;
  }

  /** M0 stand-in for a robot. Removed when M1 spawns blueprints. */
  spawnBox(x: number, y: number, size = 1, mass = 1): BodyId {
    return this.physics.createDynamicBox(x, y, size, size, mass);
  }

  step(frames: readonly InputFrame[] = []): void {
    this.inputLog.append(this.tickCount, frames);
    this.physics.step();
    this.tickCount++;
  }

  /** Hex hash of tick count plus every body's exact state. */
  hash(): string {
    const h = new StateHasher();
    h.addInt(this.tickCount);
    this.physics.hashInto(h);
    return StateHasher.hex(h.digest());
  }

  dispose(): void {
    this.physics.free();
  }
}
