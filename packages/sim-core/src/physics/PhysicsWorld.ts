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

export type JointId = number;

export interface BodySpec {
  x: number;
  y: number;
  angle?: number;
  kind: 'dynamic' | 'fixed';
}

export type ShapeSpec = { shape: 'box'; hx: number; hy: number } | { shape: 'ball'; radius: number };

export interface ColliderPlacement {
  /** Offset from the body origin, in the body frame. */
  offsetX: number;
  offsetY: number;
  angle?: number;
  mass: number;
  friction?: number;
}

export interface MotorSpec {
  /** `force`: output is a torque, so heavy robots need stronger motors. `acceleration`: mass independent. */
  model: 'force' | 'acceleration';
  targetVelocity: number;
  factor: number;
  maxTorque: number;
}

export interface MassProperties {
  mass: number;
  /** World-space center of mass. */
  comX: number;
  comY: number;
}

export interface DebugBuffers {
  vertices: Float32Array;
  colors: Float32Array;
}

/**
 * Solver settings (see docs/design/03). Rapier's defaults (4 and 1) let a 9 kg body on 1.5 kg jointed wheels
 * rebound at 4.3 m/s after a 1.5 m drop; 8 and 8 cut that to 0.6 m/s at negligible cost for robot-sized scenes.
 */
export const SOLVER_ITERATIONS = 8;
export const INTERNAL_PGS_ITERATIONS = 8;

function readState(body: RAPIER.RigidBody): BodyState {
  const t = body.translation();
  const v = body.linvel();
  return { x: t.x, y: t.y, angle: body.rotation(), vx: v.x, vy: v.y, w: body.angvel() };
}

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RAPIER.RigidBody>();
  private readonly prev = new Map<BodyId, BodyState>();
  private readonly joints = new Map<JointId, { joint: RAPIER.RevoluteImpulseJoint; factor: number }>();
  /** Rapier colliders carry no user data, so owners (part ids) live here, keyed by the opaque handle. */
  private readonly owners = new Map<number, string>();
  private nextId: BodyId = 1;
  private nextJointId: JointId = 1;

  constructor(gravityY: number, dt: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY });
    this.world.timestep = dt;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this.world.numInternalPgsIterations = INTERNAL_PGS_ITERATIONS;
  }

  /** Pose is set through the descriptor at creation, never with setRotation afterwards (determinism, see 01). */
  createBody(spec: BodySpec): BodyId {
    const base = spec.kind === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    const body = this.world.createRigidBody(base.setTranslation(spec.x, spec.y).setRotation(spec.angle ?? 0));
    const id = this.nextId++;
    this.bodies.set(id, body);
    this.prev.set(id, readState(body));
    return id;
  }

  addCollider(bodyId: BodyId, shape: ShapeSpec, place: ColliderPlacement, owner?: string): void {
    const base = shape.shape === 'box' ? RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy) : RAPIER.ColliderDesc.ball(shape.radius);
    let desc = base.setTranslation(place.offsetX, place.offsetY).setRotation(place.angle ?? 0).setMass(place.mass);
    if (place.friction !== undefined) desc = desc.setFriction(place.friction);
    const collider = this.world.createCollider(desc, this.body(bodyId));
    if (owner !== undefined) this.owners.set(collider.handle, owner);
  }

  /** Revolute joint at the given anchors (each in its own body's frame). Contacts between the two bodies are off. */
  createRevoluteJoint(
    parent: BodyId,
    child: BodyId,
    anchorParent: { x: number; y: number },
    anchorChild: { x: number; y: number },
    motor?: MotorSpec,
  ): JointId {
    const data = RAPIER.JointData.revolute(anchorParent, anchorChild);
    const joint = this.world.createImpulseJoint(data, this.body(parent), this.body(child), true) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    if (motor) {
      joint.configureMotorModel(motor.model === 'force' ? RAPIER.MotorModel.ForceBased : RAPIER.MotorModel.AccelerationBased);
      joint.configureMotorVelocity(motor.targetVelocity, motor.factor);
      joint.setMotorMaxForce(motor.maxTorque);
    }
    const id = this.nextJointId++;
    this.joints.set(id, { joint, factor: motor?.factor ?? 0 });
    return id;
  }

  /** Changes a motor's target velocity, keeping the gain it was created with. */
  setMotorVelocity(jointId: JointId, targetVelocity: number): void {
    const entry = this.joints.get(jointId);
    if (!entry) throw new Error(`unknown joint ${jointId}`);
    entry.joint.configureMotorVelocity(targetVelocity, entry.factor);
  }

  massProperties(id: BodyId): MassProperties {
    const body = this.body(id);
    const com = body.worldCom();
    return { mass: body.mass(), comX: com.x, comY: com.y };
  }

  /** Owners of every collider that has one, in creation order. */
  colliderOwners(): string[] {
    return [...this.owners.values()];
  }

  createFixedBox(cx: number, cy: number, w: number, h: number, angle = 0): BodyId {
    const id = this.createBody({ x: cx, y: cy, angle, kind: 'fixed' });
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2);
    this.world.createCollider(desc, this.body(id));
    return id;
  }

  createDynamicBox(cx: number, cy: number, w: number, h: number, mass: number, angle = 0): BodyId {
    const id = this.createBody({ x: cx, y: cy, angle, kind: 'dynamic' });
    this.addCollider(id, { shape: 'box', hx: w / 2, hy: h / 2 }, { offsetX: 0, offsetY: 0, mass });
    return id;
  }

  private body(id: BodyId): RAPIER.RigidBody {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`unknown body ${id}`);
    return body;
  }

  /** Snapshots every body's state for interpolation, then advances one fixed step. */
  step(): void {
    for (const [id, body] of this.bodies) this.prev.set(id, readState(body));
    this.world.step();
  }

  state(id: BodyId): BodyState {
    return readState(this.body(id));
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
