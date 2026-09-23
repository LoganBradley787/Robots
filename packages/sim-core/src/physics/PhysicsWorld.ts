import * as RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { StateHasher } from '../replay/StateHasher';

/** Stable id owned by us. Rapier handles are index plus generation and get reused; ours never do. */
export type BodyId = number;

export interface BodyState {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  w: number;
}

export interface DebugBuffers {
  vertices: Float32Array;
  colors: Float32Array;
}

function readState(body: RAPIER.RigidBody): BodyState {
  const t = body.translation();
  const v = body.linvel();
  return { x: t.x, y: t.y, angle: body.rotation(), vx: v.x, vy: v.y, w: body.angvel() };
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RAPIER.RigidBody>();
  private readonly prev = new Map<BodyId, BodyState>();
  private nextId: BodyId = 1;

  constructor(gravityY: number, dt: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY });
    this.world.timestep = dt;
  }

  createFixedBox(cx: number, cy: number, w: number, h: number, angle = 0): BodyId {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy).setRotation(angle);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2), body);
    return this.register(body);
  }

  createDynamicBox(cx: number, cy: number, w: number, h: number, mass: number, angle = 0): BodyId {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, cy).setRotation(angle);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2).setMass(mass), body);
    return this.register(body);
  }

  private register(body: RAPIER.RigidBody): BodyId {
    const id = this.nextId++;
    this.bodies.set(id, body);
    this.prev.set(id, readState(body));
    return id;
  }

  /** Snapshots every body's state for interpolation, then advances one fixed step. */
  step(): void {
    for (const [id, body] of this.bodies) this.prev.set(id, readState(body));
    this.world.step();
  }

  state(id: BodyId): BodyState {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`unknown body ${id}`);
    return readState(body);
  }

  prevState(id: BodyId): BodyState {
    const s = this.prev.get(id);
    if (!s) throw new Error(`unknown body ${id}`);
    return s;
  }

  get bodyIds(): BodyId[] {
    return [...this.bodies.keys()];
  }

  /** Feeds every body's exact state into the hasher in creation order. */
  hashInto(h: StateHasher): void {
    for (const [, body] of this.bodies) {
      const s = readState(body);
      h.addF64(s.x);
      h.addF64(s.y);
      h.addF64(s.angle);
      h.addF64(s.vx);
      h.addF64(s.vy);
      h.addF64(s.w);
    }
  }

  debugRender(): DebugBuffers {
    const d = this.world.debugRender();
    return { vertices: d.vertices, colors: d.colors };
  }

  free(): void {
    this.world.free();
  }
}
