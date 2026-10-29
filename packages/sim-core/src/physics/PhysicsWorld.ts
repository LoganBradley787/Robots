import * as RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { StateHasher } from '../replay/StateHasher';
import { compareText } from '../replay/compareText';
import { cos, sin } from '../math/fdlibm';

/** Rapier's raw (WASM) vector, which its public types do not name. */
type RawVector = ReturnType<typeof RAPIER.VectorOps.intoRaw>;

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
/** Batch: a rope (a Rapier rope joint between two bodies), by our own id. */
export type RopeId = number;

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

/** A terrain collider (one without an owner), for line-of-sight tests. Boxes only. */
export interface TerrainBox {
  x: number;
  y: number;
  hx: number;
  hy: number;
  angle: number;
}

export interface MotorSpec {
  /** Target rad/s of the child relative to the parent, counterclockwise positive. */
  targetVelocity: number;
  /** Torque per rad/s of speed error, before the cap. */
  factor: number;
  /** N m. The motor outputs torque, so heavy robots need stronger motors. */
  maxTorque: number;
}

interface JointEntry {
  parent: BodyId;
  child: BodyId;
  /**
   * `velocity`: target rad/s of the child relative to the parent, with gain `factor`. `position`: target angle of the
   * child relative to the parent, held with stiffness `factor` and damping `damping`. Torque cap `maxTorque` (0 = off).
   */
  kind: 'velocity' | 'position';
  factor: number;
  damping: number;
  target: number;
  /** Position motors: how fast the target angle is moving (rad/s), so a moving aim is tracked without lag. */
  rate: number;
  maxTorque: number;
  /** Batch: position motors' integral gain (N m per rad per second); 0 is a plain spring and damper. */
  integralGain: number;
  /** Batch: the integral term's accumulated torque (N m). Simulation state: hashed when nonzero. */
  integral: number;
}

/**
 * Batch: a prismatic (sliding) joint, the piston's. `axis` is the slide direction in the child's frame (which the
 * joint keeps aligned with the parent's rest frame). `position` counts meters of extension from the anchor's rest pose.
 * The motor is a spring, a damper, and an integral term that learns the load (a car parked on the head), plus a
 * feed-forward for the weight of the child body itself, capped at `maxForce`.
 */
interface SliderEntry {
  parent: BodyId;
  child: BodyId;
  anchorParent: { x: number; y: number };
  axis: { x: number; y: number };
  target: number;
  rate: number;
  stiffness: number;
  damping: number;
  maxForce: number;
  integral: number;
}

/** How fast the slider motor's integral term learns a load, per second (times the stiffness). */
const SLIDER_INTEGRAL_RATE = 4;

/** Batch: within this error (rad) a position motor counts as on target and its integral term bleeds. */
export const INTEGRAL_DEADBAND = 0.0002;
/** Batch: the fraction of the integral term bled per second while on target. */
export const INTEGRAL_BLEED = 0.05;

/** Batch: a rope's stiffness (Hz on the two ends' combined mass), damping ratio, and strongest pull in N. */
const ROPE_HZ = 4;
const ROPE_DAMPING = 0.7;
const ROPE_MAX_FORCE = 30000;

/** Mass of the invisible helper bodies (a multibody root, a joint pivot): small enough to change nothing measurable. */
const HELPER_MASS = 0.001;

/** An angle wrapped into [-pi, pi). */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

export interface MassProperties {
  mass: number;
  /** World-space center of mass. */
  comX: number;
  comY: number;
  /** Moment of inertia about the center of mass, kg m^2. */
  inertia: number;
}

/**
 * Crash: one contact manifold between two colliders on the last step, in Rapier's own order for the pair (side 1 is
 * its first collider, side 2 its second), so both sides read the same record. `jx`, `jy` is the whole impulse (normal
 * plus friction, N s) side 1 put on side 2 over the step; side 1 took the opposite. (`px`, `py`) is where it acted: the mean of the solver points, or the middle of the two colliders when
 * Rapier kept none.
 */
export interface ContactImpulse {
  body1: BodyId;
  owner1: string | undefined;
  body2: BodyId;
  owner2: string | undefined;
  jx: number;
  jy: number;
  px: number;
  py: number;
  /** The solver points, for where the hit landed. */
  points: { x: number; y: number }[];
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

/**
 * Air drag per robot cell (M5, see docs/design/03): force `-AIR_DRAG * cells * |v| * v` on each robot body, and
 * torque `-AIR_SPIN_DRAG * cells * |w| * w` (not on bodies hanging on a joint: a spinning wheel is not tumbling). Quadratic, so a car at 19 m/s barely notices while a hopper under full
 * thrust tops out instead of climbing to 20 km. Terrain has no cells and no drag.
 */
export const AIR_DRAG = 0.0025;
export const AIR_SPIN_DRAG = 0.002;

function readState(body: RAPIER.RigidBody): BodyState {
  const t = body.translation();
  const v = body.linvel();
  return { x: t.x, y: t.y, angle: body.rotation(), vx: v.x, vy: v.y, w: body.angvel() };
}

/** A manifold's key: its pair's collider handles in the pair's own order and its place in the pair. */
function manifoldKey(h1: number, h2: number, index: number): string {
  return `${h1}|${h2}|${index}`;
}

const handleBits = new Float64Array(1);
const handleWords = new Uint32Array(handleBits.buffer);

/** A collider handle's arena index (its low 32 bits; the high ones are the slot's generation), Rapier's own order. */
function arenaIndex(handle: number): number {
  handleBits[0] = handle;
  return handleWords[0]!;
}

/** A collider created since the last step (`PhysicsWorld.fresh`). */
interface FreshCollider {
  handle: number;
  /** Holds the shape at any turn: a ball's radius, a box's half width plus half height. */
  r: number;
  /** Where it is, once read (NaN until then). */
  x: number;
  y: number;
}

/** Meters added to the reach test for colliders created since the last step, far more than any rounding. */
const FRESH_SLACK = 0.1;

export class PhysicsWorld {
  /** Gravity's y (m/s^2, negative is down), for things that feed it forward (Batch: the piston). */
  readonly gravityY: number;
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RAPIER.RigidBody>();
  private readonly prev = new Map<BodyId, BodyState>();
  /** Bodies that hang on a joint (wheels): no spin drag. */
  private readonly jointChildren = new Set<BodyId>();
  /** Bodies with forces or torques added for the next step; cleared after it. */
  private readonly forced = new Set<BodyId>();
  private readonly joints = new Map<JointId, JointEntry>();
  /** Batch: sliding joints (pistons), by joint id. Empty in worlds without one, which then hash as before. */
  private readonly sliders = new Map<JointId, SliderEntry>();
  /** Rapier body handle to our id, for mapping colliders back to bodies. */
  private readonly byHandle = new Map<number, BodyId>();
  /** Rapier colliders carry no user data, so owners (part ids) live here, keyed by the opaque handle. */
  private readonly owners = new Map<number, string>();
  /**
   * Each body's owned colliders (their handles): its robot cells, counted for air drag, and forgotten with the body
   * without asking Rapier for each (a body can have thousands).
   */
  private readonly owned = new Map<BodyId, number[]>();
  /** The joints (turning and sliding) at each body, as parent or child, to forget them with it. */
  private readonly jointsAt = new Map<BodyId, JointId[]>();
  /** Invisible bodies that exist for another body (its multibody root, its joint pivot), removed with it. */
  private readonly helpers = new Map<BodyId, BodyId[]>();
  /** Bodies that are links of a multibody (anything with a turning or sliding joint, or a kept root angle). */
  private readonly linked = new Set<BodyId>();
  private nextId: BodyId = 1;
  private nextJointId: JointId = 1;
  /**
   * Batch: ropes between two bodies, gone with either body. A rope is forces, not a Rapier joint: a robot with a rotator
   * or wheels is multibody links, and Rapier drops impulses on links, so a rope joint stretched without limit there.
   */
  private readonly ropes = new Map<RopeId, { a: BodyId; b: BodyId; anchorA: { x: number; y: number }; anchorB: { x: number; y: number }; length: number }>();
  private nextRopeId: RopeId = 1;
  /** The fixed step as Rapier holds it (a 32-bit float), seconds. */
  private readonly stepSeconds: number;
  /** Velocities waiting to be given to bodies (`kick`) at the start of the next step (`applyKicks`). */
  private readonly kicks = new Map<BodyId, { vx: number; vy: number; w: number }>();
  /**
   * Colliders created since the last step, in creation order: the handle, a radius that holds the shape at any turn,
   * and where the collider is (read from Rapier on the first scan that needs it; NaN until then). Rapier's query
   * index (its broad phase) is rebuilt at the end of each step, so it misses these until the next one; `scanOverlaps`
   * tests them directly. Nothing moves a collider between steps, so a place once read holds until the step.
   */
  private fresh: FreshCollider[] = [];
  /** What `makeCollider` reuses, from the first collider made on. */
  private rawKit: { tra: RawVector; com: RawVector; shapes: Map<string, ReturnType<RAPIER.Shape['intoRaw']>>; turns: Map<number | string, ReturnType<typeof RAPIER.RotationOps.intoRaw>> } | undefined;

  constructor(gravityY: number, dt: number) {
    this.gravityY = gravityY;
    this.world = new RAPIER.World({ x: 0, y: gravityY });
    this.world.timestep = dt;
    this.stepSeconds = this.world.timestep;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this.world.numInternalPgsIterations = INTERNAL_PGS_ITERATIONS;
  }

  /** The fixed step, seconds. */
  get dt(): number {
    return this.stepSeconds;
  }

  /** Pose is set through the descriptor at creation, never with setRotation afterwards (determinism, see 01). */
  createBody(spec: BodySpec, helperMass?: number): BodyId {
    let base = spec.kind === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    if (helperMass !== undefined) base = base.setAdditionalMass(helperMass);
    const body = this.world.createRigidBody(base.setTranslation(spec.x, spec.y).setRotation(spec.angle ?? 0));
    const id = this.nextId++;
    this.bodies.set(id, body);
    this.byHandle.set(body.handle, id);
    this.prev.set(id, readState(body));
    return id;
  }

  addCollider(bodyId: BodyId, shape: ShapeSpec, place: ColliderPlacement, owner?: string): void {
    const base = shape.shape === 'box' ? RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy) : RAPIER.ColliderDesc.ball(shape.radius);
    let desc = base.setTranslation(place.offsetX, place.offsetY).setRotation(place.angle ?? 0).setMass(place.mass);
    if (place.friction !== undefined) desc = desc.setFriction(place.friction);
    const collider = this.makeCollider(desc, this.body(bodyId), shape.shape === 'box' ? `b${shape.hx},${shape.hy}` : `r${shape.radius}`);
    this.fresh.push({ handle: collider.handle, r: shape.shape === 'box' ? shape.hx + shape.hy : shape.radius, x: NaN, y: NaN });
    if (owner !== undefined) {
      this.owners.set(collider.handle, owner);
      const list = this.owned.get(bodyId);
      if (list) list.push(collider.handle);
      else this.owned.set(bodyId, [collider.handle]);
    }
  }

  /** Removes a body with its colliders, its joints, and its helper bodies. */
  removeBody(id: BodyId): void {
    for (const h of this.helpers.get(id) ?? []) this.removeBody(h);
    this.helpers.delete(id);
    const body = this.body(id);
    for (const handle of this.owned.get(id) ?? []) this.owners.delete(handle);
    this.owned.delete(id);
    for (const jointId of this.jointsAt.get(id) ?? []) {
      this.joints.delete(jointId);
      this.sliders.delete(jointId);
    }
    this.jointsAt.delete(id);
    // Rapier drops a body's impulse joints with it; forget ours.
    for (const [ropeId, r] of this.ropes) if (r.a === id || r.b === id) this.ropes.delete(ropeId);
    this.byHandle.delete(body.handle);
    this.world.removeRigidBody(body);
    this.bodies.delete(id);
    this.prev.delete(id);
    this.jointChildren.delete(id);
    this.linked.delete(id);
    this.forced.delete(id);
    this.kicks.delete(id);
  }

  /**
   * Makes a body that is about to get joints keep its rotation. Rapier starts a multibody's root at angle 0 whatever
   * the body's pose (spike, M6), so a piece rebuilt mid-tumble would snap upright. The root becomes an invisible helper
   * welded to the body with the angle in the weld's frame. Call before creating the body's joints; skip at angle 0.
   */
  keepRootAngle(id: BodyId, angle: number): void {
    if (angle === 0) return;
    const s = this.state(id);
    const root = this.createBody({ x: s.x, y: s.y, kind: 'dynamic' }, HELPER_MASS);
    this.addHelper(id, root);
    this.linked.add(id);
    const weld = this.world.createMultibodyJoint(RAPIER.JointData.fixed({ x: 0, y: 0 }, angle, { x: 0, y: 0 }, 0), this.body(root), this.body(id), true);
    weld.setContactsEnabled(false);
  }

  private noteJoint(jointId: JointId, parent: BodyId, child: BodyId): void {
    for (const body of [parent, child]) {
      this.linked.add(body);
      const list = this.jointsAt.get(body);
      if (list) list.push(jointId);
      else this.jointsAt.set(body, [jointId]);
    }
  }

  private addHelper(owner: BodyId, helper: BodyId): void {
    const list = this.helpers.get(owner) ?? [];
    list.push(helper);
    this.helpers.set(owner, list);
  }

  /**
   * Gives a body a velocity: its center of mass moves at (vx, vy) and it turns at w, from the start of the next step
   * (`applyKicks`). Works on multibody links, whose velocity Rapier does not let be written (spike, M6). Until that
   * step the body reads as moving so (`state`, and the motors, drag and ropes worked out at the step's start).
   */
  kick(id: BodyId, vx: number, vy: number, w: number): void {
    this.body(id);
    this.kicks.set(id, { vx, vy, w });
  }

  /** The kicks waiting for the next step, in the order they were given (the world hashes them: `World.hash`). */
  waitingKicks(): ReadonlyMap<BodyId, { vx: number; vy: number; w: number }> {
    return this.kicks;
  }

  /** A body's velocity as the world should see it: a waiting kick's, else Rapier's. */
  private velocity(id: BodyId, body: RAPIER.RigidBody): { x: number; y: number; w: number } {
    const k = this.kicks.get(id);
    if (k) return { x: k.vx, y: k.vy, w: k.w };
    const v = body.linvel();
    return { x: v.x, y: v.y, w: body.angvel() };
  }

  /**
   * The start of a step with kicks waiting: its first substep is stepped on its own (a Rapier step one substep long,
   * with the usual solver iterations), with each kicked body given on top of its forces for the tick the force and
   * torque that change its velocity to the kick's within that substep: `F = m (v - v0) / h`, `tau = I (w - w0) / h`.
   * Then the kicks come off, and `step` runs the other substeps as one Rapier step. Every substep keeps its usual
   * length, and every force of the tick acts through all of them. Returns whether it stepped.
   *
   * Rapier ignores velocity writes on multibody links, root included, and gives no access to a multibody's own
   * velocities (measured on 0.20). Until 2026-10-22 a kick was a force over the whole step, which Rapier adds to the
   * velocity a share per substep: a kicked link started the step at rest and reached its velocity only at the end. It
   * moved 9/16 of the step's distance, and anything it touched in that step met it nearly standing still: a dart just
   * let go, flying on at full speed inside its bay, slammed into the bay's wall (titan-hive lost 9 darts a minute
   * flying sideways at 40 m/s). A first try stepped 2^-16 s on its own instead of a substep: contacts warm-started
   * from a whole step's impulses in a step that short threw resting robots around (an untouched titan at rest jumped
   * 41 m/s inside it, and lost half its parts to the crash check).
   */
  applyKicks(): boolean {
    if (this.kicks.size === 0) return false;
    const h = this.stepSeconds / SOLVER_ITERATIONS;
    const held: { body: RAPIER.RigidBody; fx: number; fy: number; torque: number }[] = [];
    for (const [id, k] of this.kicks) {
      const body = this.body(id);
      const f = body.userForce();
      held.push({ body, fx: f.x, fy: f.y, torque: body.userTorque() });
      // Rapier's own velocity: the force has to change that one.
      const v = body.linvel();
      const m = body.mass();
      body.addForce({ x: (m * (k.vx - v.x)) / h, y: (m * (k.vy - v.y)) / h }, true);
      body.addTorque((body.principalInertia() * (k.w - body.angvel())) / h, true);
    }
    this.kicks.clear();
    this.world.timestep = h;
    this.world.numSolverIterations = 1;
    this.world.step();
    for (const x of held) {
      x.body.resetForces(false);
      x.body.resetTorques(false);
      if (x.fx !== 0 || x.fy !== 0) x.body.addForce({ x: x.fx, y: x.fy }, false);
      if (x.torque !== 0) x.body.addTorque(x.torque, false);
    }
    return true;
  }

  /** Whether the body moves (a robot's body, a world file's dynamic box), not fixed terrain. */
  isDynamic(id: BodyId): boolean {
    return this.body(id).isDynamic();
  }

  /**
   * Whether the body is a link of a multibody. Rapier ignores velocity writes on a link, which takes a `kick`; a body
   * that is not one can be given its velocity outright (`setVelocity`).
   */
  isLinked(id: BodyId): boolean {
    return this.linked.has(id);
  }

  /**
   * Sets a body's velocity now: its center of mass moves at (vx, vy) and it turns at w. Only for a body that is not a
   * link (`isLinked`); a link takes a `kick`.
   */
  setVelocity(id: BodyId, vx: number, vy: number, w: number): void {
    if (this.linked.has(id)) throw new Error(`body ${id} is a multibody link: kick it`);
    const body = this.body(id);
    this.kicks.delete(id);
    body.setLinvel({ x: vx, y: vy }, true);
    body.setAngvel(w, true);
    // It has not been stepped: its state a step ago is its state now.
    this.prev.set(id, readState(body));
  }

  /** Whether the body still exists. */
  hasBody(id: BodyId): boolean {
    return this.bodies.has(id);
  }

  /**
   * Batch (grapple): a rope joint holding two points, one in each body's frame, at most `length` meters apart. Slack
   * ropes do nothing. It goes when either body is removed (a robot rebuilt after damage): make it again on the new body.
   */
  createRope(a: BodyId, b: BodyId, anchorA: { x: number; y: number }, anchorB: { x: number; y: number }, length: number): RopeId {
    const id = this.nextRopeId++;
    this.ropes.set(id, { a, b, anchorA: { ...anchorA }, anchorB: { ...anchorB }, length });
    return id;
  }

  /**
   * Each rope pulls its two anchor points together once they are more than its length apart: a stiff spring (about
   * 4 Hz on the two bodies' combined mass) damped by how fast the ends separate, never pushing, capped. Applied as
   * forces for this step, which work on multibody links. A fixed body (the ground) takes nothing and adds no mass.
   */
  private pullRopes(): void {
    for (const r of this.ropes.values()) {
      const ba = this.bodies.get(r.a);
      const bb = this.bodies.get(r.b);
      if (!ba || !bb) continue;
      const end = (id: BodyId, b: RAPIER.RigidBody, anchor: { x: number; y: number }) => {
        const t = b.translation();
        const rot = b.rotation();
        const c = cos(rot);
        const n = sin(rot);
        const x = t.x + c * anchor.x - n * anchor.y;
        const y = t.y + n * anchor.x + c * anchor.y;
        const v = this.velocity(id, b);
        const w = v.w;
        const com = b.worldCom();
        return { x, y, vx: v.x - w * (y - com.y), vy: v.y + w * (x - com.x), m: b.isDynamic() ? b.mass() : 0 };
      };
      const p = end(r.a, ba, r.anchorA);
      const q = end(r.b, bb, r.anchorB);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r.length || d === 0) continue;
      const ux = dx / d;
      const uy = dy / d;
      const m = p.m > 0 && q.m > 0 ? (p.m * q.m) / (p.m + q.m) : Math.max(p.m, q.m);
      if (m <= 0) continue;
      const omega = 2 * Math.PI * ROPE_HZ;
      const opening = (q.vx - p.vx) * ux + (q.vy - p.vy) * uy;
      const pull = Math.min(ROPE_MAX_FORCE, Math.max(0, m * omega * omega * (d - r.length) + 2 * ROPE_DAMPING * m * omega * opening));
      if (pull === 0) continue;
      if (p.m > 0) this.addForceAt(r.a, ux * pull, uy * pull, p.x, p.y);
      if (q.m > 0) this.addForceAt(r.b, -ux * pull, -uy * pull, q.x, q.y);
    }
  }

  /** Whether the rope is still there (it is not once one of its bodies is removed). */
  ropeAlive(id: RopeId): boolean {
    return this.ropes.has(id);
  }

  removeRope(id: RopeId): void {
    this.ropes.delete(id);
  }

  /** Terrain colliders (no owner) that are boxes, in creation order. */
  terrainBoxes(): TerrainBox[] {
    const out: TerrainBox[] = [];
    this.world.forEachCollider((c) => {
      if (this.owners.has(c.handle) || !(c.shape instanceof RAPIER.Cuboid)) return;
      const t = c.translation();
      const h = c.shape.halfExtents;
      out.push({ x: t.x, y: t.y, hx: h.x, hy: h.y, angle: c.rotation() });
    });
    return out;
  }

  /**
   * The body and anchor a multibody joint to `child` should hang from. Rapier starts every multibody joint at its rest
   * pose (spike, M6), so a child that is already turned by `relAngle` (or slid by `slide`, in the child's rest frame)
   * goes through an invisible pivot welded to the parent at that pose; with neither it is the parent itself.
   */
  private jointFrame(
    parent: BodyId,
    child: BodyId,
    anchorParent: { x: number; y: number },
    anchorChild: { x: number; y: number },
    relAngle: number,
    slide = { x: 0, y: 0 },
  ): { from: RAPIER.RigidBody; fromAnchor: { x: number; y: number } } {
    if (relAngle === 0 && slide.x === 0 && slide.y === 0) return { from: this.body(parent), fromAnchor: anchorParent };
    const p = this.state(parent);
    const c = cos(p.angle);
    const n = sin(p.angle);
    // The pivot's spot in the parent's frame: the anchor plus the slide (turned from the child's rest frame into the parent's).
    const cr = cos(relAngle);
    const sr = sin(relAngle);
    const at = { x: anchorParent.x + cr * slide.x - sr * slide.y, y: anchorParent.y + sr * slide.x + cr * slide.y };
    const pivot = this.createBody({ x: p.x + c * at.x - n * at.y, y: p.y + n * at.x + c * at.y, kind: 'dynamic' }, HELPER_MASS);
    this.addHelper(child, pivot);
    const weld = this.world.createMultibodyJoint(RAPIER.JointData.fixed(at, relAngle, { x: 0, y: 0 }, 0), this.body(parent), this.body(pivot), true);
    weld.setContactsEnabled(false);
    // Rapier only skips contacts between bodies joined directly. The parent and child now meet through the pivot,
    // so a spring with no stiffness joins them only to switch their contacts off (else a rotator's box would rest
    // on the part it turns on and jam).
    const quiet = this.world.createImpulseJoint(RAPIER.JointData.spring(0, 0, 0, anchorParent, anchorChild), this.body(parent), this.body(child), true);
    quiet.setContactsEnabled(false);
    return { from: this.body(pivot), fromAnchor: { x: 0, y: 0 } };
  }

  /**
   * Revolute joint at the given anchors (each in its own body's frame). Contacts between the two bodies are off.
   * `relAngle` is the child's angle relative to the parent now (0 at spawn). Rapier starts every multibody joint at
   * relative angle 0 (spike, M6), so a nonzero one goes through an invisible pivot welded to the parent at that angle.
   */
  createRevoluteJoint(
    parent: BodyId,
    child: BodyId,
    anchorParent: { x: number; y: number },
    anchorChild: { x: number; y: number },
    motor?: MotorSpec,
    relAngle = 0,
  ): JointId {
    // A multibody joint, not an impulse joint: impulse joints stretch and feed energy back under a driven wheel that
    // slips and lands (a car driven off a ledge bounced higher each time and flipped, Gate 3). Multibody joints are
    // exact, but Rapier's JS API has no motor for them, so the motor is ours (applied as torques in `step`).
    const { from, fromAnchor } = this.jointFrame(parent, child, anchorParent, anchorChild, relAngle);
    const joint = this.world.createMultibodyJoint(RAPIER.JointData.revolute(fromAnchor, anchorChild), from, this.body(child), true);
    joint.setContactsEnabled(false);
    this.jointChildren.add(child);
    const id = this.nextJointId++;
    this.noteJoint(id, parent, child);
    this.joints.set(id, { parent, child, kind: 'velocity', factor: motor?.factor ?? 0, damping: 0, target: motor?.targetVelocity ?? 0, rate: 0, maxTorque: motor?.maxTorque ?? 0, integralGain: 0, integral: 0 });
    return id;
  }

  /**
   * Batch (piston): a sliding joint. The child slides along `axis` (in its own frame, which the joint keeps at the
   * parent's `relAngle`) between 0 and `stroke` meters from the parent's anchor; `extension` is where it already is
   * (a piece rebuilt mid-stroke). Contacts between the two bodies are off. The motor is ours: see `setSliderMotor`.
   */
  createPrismaticJoint(
    parent: BodyId,
    child: BodyId,
    anchorParent: { x: number; y: number },
    axis: { x: number; y: number },
    stroke: number,
    extension = 0,
    relAngle = 0,
  ): JointId {
    const e = Math.max(0, Math.min(stroke, extension));
    const { from, fromAnchor } = this.jointFrame(parent, child, anchorParent, { x: 0, y: 0 }, relAngle, { x: axis.x * e, y: axis.y * e });
    const data = RAPIER.JointData.prismatic(fromAnchor, { x: 0, y: 0 }, axis);
    // Measured from the pivot, which sits `e` along the stroke: the child may go back `e` and forward the rest.
    data.limitsEnabled = true;
    data.limits = [-e, stroke - e];
    const joint = this.world.createMultibodyJoint(data, from, this.body(child), true);
    joint.setContactsEnabled(false);
    const id = this.nextJointId++;
    this.noteJoint(id, parent, child);
    this.sliders.set(id, { parent, child, anchorParent, axis, target: e, rate: 0, stiffness: 0, damping: 0, maxForce: 0, integral: 0 });
    return id;
  }

  /**
   * Holds a sliding joint at `target` meters of extension (rate = how fast the target moves, m/s, so a moving target
   * is tracked without lag): force `stiffness * error + damping * (rate - speed)` plus a learned load, capped at
   * `maxForce` N (0 = off). The child's own weight is fed forward, so a piston lifting a block needs no sag to hold it.
   */
  setSliderMotor(jointId: JointId, target: number, rate: number, stiffness: number, damping: number, maxForce: number): void {
    const s = this.slider(jointId);
    s.target = target;
    s.rate = rate;
    s.stiffness = stiffness;
    s.damping = damping;
    s.maxForce = maxForce;
  }

  /** How far a sliding joint's child is from its rest pose along the axis, meters. */
  sliderPosition(jointId: JointId): number {
    return this.sliderState(this.slider(jointId)).position;
  }

  /** How fast a sliding joint is extending, m/s (the child's speed along the axis relative to the parent's). */
  sliderSpeed(jointId: JointId): number {
    return this.sliderState(this.slider(jointId)).speed;
  }

  /**
   * The mass (kg) beyond the child's own that a sliding joint's motor has learned to hold up against gravity (a car
   * parked on the head), from its load term; 0 when it pushes across gravity or has learned nothing.
   */
  sliderCarriedMass(jointId: JointId): number {
    const s = this.slider(jointId);
    const g = this.gravityY;
    if (g === 0) return 0;
    return Math.max(0, (s.integral * -g * this.sliderState(s).ay) / (g * g));
  }

  private slider(jointId: JointId): SliderEntry {
    const entry = this.sliders.get(jointId);
    if (!entry) throw new Error(`unknown slider ${jointId}`);
    return entry;
  }

  /** Extension, speed, and slide direction (world frame) of a slider, at the child's origin. */
  private sliderState(s: SliderEntry): { position: number; speed: number; ax: number; ay: number; px: number; py: number } {
    const p = this.body(s.parent);
    const c = this.body(s.child);
    const ct = c.translation();
    const ca = c.rotation();
    const ax = cos(ca) * s.axis.x - sin(ca) * s.axis.y;
    const ay = sin(ca) * s.axis.x + cos(ca) * s.axis.y;
    const pt = p.translation();
    const pa = p.rotation();
    const anchorX = pt.x + cos(pa) * s.anchorParent.x - sin(pa) * s.anchorParent.y;
    const anchorY = pt.y + sin(pa) * s.anchorParent.x + cos(pa) * s.anchorParent.y;
    const position = (ct.x - anchorX) * ax + (ct.y - anchorY) * ay;
    // Velocity of each body at the child's origin: linear plus spin about the center of mass.
    const cc = c.worldCom();
    const pc = p.worldCom();
    const cv = this.velocity(s.child, c);
    const pv = this.velocity(s.parent, p);
    const cw = cv.w;
    const pw = pv.w;
    const rvx = cv.x - cw * (ct.y - cc.y) - (pv.x - pw * (ct.y - pc.y));
    const rvy = cv.y + cw * (ct.x - cc.x) - (pv.y + pw * (ct.x - pc.x));
    return { position, speed: rvx * ax + rvy * ay, ax, ay, px: ct.x, py: ct.y };
  }

  /** Changes a motor's target velocity, keeping the gain it was created with. */
  setMotorVelocity(jointId: JointId, targetVelocity: number): void {
    const entry = this.joint(jointId);
    this.setMotor(jointId, targetVelocity, entry.factor, entry.maxTorque);
  }

  /**
   * Sets a velocity motor's target (rad/s of the child relative to the parent, counterclockwise positive), gain,
   * and torque cap. Only touches Rapier when something changed, so a steady motor lets its bodies sleep.
   */
  setMotor(jointId: JointId, targetVelocity: number, factor: number, maxTorque: number): void {
    const entry = this.joint(jointId);
    entry.kind = 'velocity';
    entry.target = targetVelocity;
    entry.factor = factor;
    entry.maxTorque = maxTorque;
  }

  /**
   * Sets a position motor: holds the child at `targetAngle` (radians, relative to the parent, counterclockwise
   * positive) with torque `stiffness * error - damping * (relative spin - rate)`, capped at `maxTorque`. `rate` is
   * how fast the target is moving (rad/s), 0 to hold still. `integralGain` (Batch) adds an integral term: torque
   * that builds at `integralGain * error` per second while off target (so a steady load stops sagging the joint),
   * bleeds while on target, and never exceeds `maxTorque` (no windup).
   */
  setPositionMotor(jointId: JointId, targetAngle: number, stiffness: number, damping: number, maxTorque: number, rate = 0, integralGain = 0): void {
    const entry = this.joint(jointId);
    if (entry.kind !== 'position') entry.integral = 0;
    entry.kind = 'position';
    entry.integralGain = integralGain;
    entry.target = targetAngle;
    entry.rate = rate;
    entry.factor = stiffness;
    entry.damping = damping;
    entry.maxTorque = maxTorque;
  }

  /** The child's angle relative to the parent, wrapped into [-pi, pi). */
  jointAngle(jointId: JointId): number {
    const j = this.joint(jointId);
    return wrapAngle(this.body(j.child).rotation() - this.body(j.parent).rotation());
  }

  private joint(jointId: JointId): JointEntry {
    const entry = this.joints.get(jointId);
    if (!entry) throw new Error(`unknown joint ${jointId}`);
    return entry;
  }

  /**
   * Adds a force (N, world frame) at a world point for the next step only. Forces, not impulses: a robot's bodies are
   * multibody links, whose velocities Rapier recomputes from the joints, so a direct impulse on a link is lost.
   */
  addForceAt(id: BodyId, fx: number, fy: number, px: number, py: number): void {
    this.body(id).addForceAtPoint({ x: fx, y: fy }, { x: px, y: py }, true);
    this.forced.add(id);
  }

  /**
   * The dynamic body whose collider contains the world point, or undefined. Tests colliders directly, like
   * `overlapsShapes`, because the query index lags behind new colliders. Fixed bodies (terrain) are ignored.
   */
  dynamicBodyAt(x: number, y: number): BodyId | undefined {
    let found: BodyId | undefined;
    this.world.forEachCollider((c) => {
      if (found !== undefined) return;
      const parent = c.parent();
      if (!parent || !parent.isDynamic()) return;
      if (c.containsPoint({ x, y })) found = this.byHandle.get(parent.handle);
    });
    return found;
  }

  massProperties(id: BodyId): MassProperties {
    const body = this.body(id);
    const com = body.worldCom();
    return { mass: body.mass(), comX: com.x, comY: com.y, inertia: body.principalInertia() };
  }

  /** Adds a torque (N m, counterclockwise positive) for the next step only. Works on multibody links. */
  addTorque(id: BodyId, torque: number): void {
    this.body(id).addTorque(torque, true);
    this.forced.add(id);
  }

  /**
   * True when any of the shapes (world space, unrotated) overlaps an existing collider. Shapes are shrunk by
   * `margin` so resting exactly against something counts as free. Sees colliders created since the last step too
   * (a robot just spawned, or a world that is paused), which Rapier's query index misses (`scanOverlaps`).
   */
  overlapsShapes(shapes: readonly { x: number; y: number; shape: ShapeSpec }[], margin = 0.02): boolean {
    let hit = false;
    this.scanOverlaps(shapes, margin, () => {
      hit = true;
      return true;
    });
    return hit;
  }

  /**
   * Batch: the dynamic bodies any of the shapes overlaps, in the order Rapier lists their colliders (stable for a given
   * world). Terrain is left out, so a caller sees which pieces (not the ground) are in the way.
   */
  overlappingBodies(shapes: readonly { x: number; y: number; shape: ShapeSpec }[], margin = 0.02): BodyId[] {
    const found: BodyId[] = [];
    this.scanOverlaps(shapes, margin, (c) => {
      const parent = c.parent();
      const id = parent && parent.isDynamic() ? this.byHandle.get(parent.handle) : undefined;
      if (id !== undefined && !found.includes(id)) found.push(id);
      return false;
    });
    return found;
  }

  /**
   * Calls `visit` on every collider that overlaps any shape, in the order Rapier lists its colliders (arena index),
   * stopping once it returns true. Asks Rapier's query index, which holds every collider as it was after the last step
   * (nothing moves a collider between steps here), plus the colliders created since, tested directly.
   */
  private scanOverlaps(shapes: readonly { x: number; y: number; shape: ShapeSpec }[], margin: number, visit: (c: RAPIER.Collider) => boolean): void {
    const shrink = (v: number): number => Math.max(0.001, v - margin);
    const probes = shapes.map((s) => ({
      pos: { x: s.x, y: s.y },
      shape: s.shape.shape === 'box' ? new RAPIER.Cuboid(shrink(s.shape.hx), shrink(s.shape.hy)) : new RAPIER.Ball(shrink(s.shape.radius)),
    }));
    const hits = new Map<number, RAPIER.Collider>();
    for (const p of probes) {
      this.world.intersectionsWithShape(p.pos, 0, p.shape, (c) => {
        hits.set(c.handle, c);
        return true;
      });
    }
    // Each probe's reach: a radius that holds its shape at any turn.
    const reach = shapes.map((s) => (s.shape.shape === 'box' ? shrink(s.shape.hx) + shrink(s.shape.hy) : shrink(s.shape.radius)));
    for (const f of this.fresh) {
      const handle = f.handle;
      if (hits.has(handle)) continue;
      const c = this.world.getCollider(handle);
      // Gone since (the lookup is by arena index, so a newer collider in the same slot answers for it).
      if (!c || c.handle !== handle) continue;
      if (f.x !== f.x) {
        const t = c.translation();
        f.x = t.x;
        f.y = t.y;
      }
      // Only a probe whose reach meets the collider's can touch it: the rest are passed over without asking Rapier.
      // FRESH_SLACK keeps the test wide of rounding, so it never passes over a collider Rapier would call touching.
      let near = false;
      for (let i = 0; i < probes.length; i++) {
        const dx = f.x - shapes[i]!.x;
        const dy = f.y - shapes[i]!.y;
        const d = f.r + reach[i]! + FRESH_SLACK;
        if (dx * dx + dy * dy <= d * d) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const pos = { x: f.x, y: f.y };
      const rot = c.rotation();
      if (probes.some((p) => c.shape.intersectsShape(pos, rot, p.shape, p.pos, 0))) hits.set(handle, c);
    }
    if (hits.size === 0) return;
    const order = [...hits.keys()].sort((x, y) => arenaIndex(x) - arenaIndex(y));
    for (const handle of order) if (visit(hits.get(handle)!)) return;
  }

  /**
   * The first collider a ray from (x, y) along the unit vector (dx, dy) touches within `length` meters (M13: shells and
   * gun sights): its body, its owner (the part id; undefined for terrain), and how far along. A ray that starts inside a
   * collider hits it at 0. `skip` leaves out colliders it returns true for. Uses Rapier's query index, which is fresh
   * right after a step: colliders created since (a robot rebuilt after the step) are missed until the next one.
   */
  castRay(x: number, y: number, dx: number, dy: number, length: number, skip?: (body: BodyId, owner: string | undefined) => boolean): { body: BodyId; owner: string | undefined; distance: number } | undefined {
    const ray = new RAPIER.Ray({ x, y }, { x: dx, y: dy });
    const filter = skip ? (c: RAPIER.Collider): boolean => {
      const parent = c.parent();
      const body = parent ? this.byHandle.get(parent.handle) : undefined;
      return body === undefined || !skip(body, this.owners.get(c.handle));
    } : undefined;
    const hit = this.world.castRay(ray, length, true, undefined, undefined, undefined, undefined, filter);
    if (!hit) return undefined;
    const parent = hit.collider.parent();
    const body = parent ? this.byHandle.get(parent.handle) : undefined;
    if (body === undefined) return undefined;
    return { body, owner: this.owners.get(hit.collider.handle), distance: hit.timeOfImpact };
  }

  /**
   * Every collider a ray from (x, y) along the unit vector (dx, dy) touches within `length` meters, nearest first (ties
   * by body id, then owner, so the order never depends on Rapier's handles). Same rules as `castRay`.
   */
  rayHits(x: number, y: number, dx: number, dy: number, length: number, skip?: (body: BodyId, owner: string | undefined) => boolean): { body: BodyId; owner: string | undefined; distance: number }[] {
    const ray = new RAPIER.Ray({ x, y }, { x: dx, y: dy });
    const out: { body: BodyId; owner: string | undefined; distance: number }[] = [];
    this.world.intersectionsWithRay(ray, length, true, (hit) => {
      const parent = hit.collider.parent();
      const body = parent ? this.byHandle.get(parent.handle) : undefined;
      const owner = this.owners.get(hit.collider.handle);
      if (body !== undefined && !skip?.(body, owner)) out.push({ body, owner, distance: hit.timeOfImpact });
      return true;
    });
    return out.sort((a, b) => a.distance - b.distance || a.body - b.body || compareText(a.owner ?? '', b.owner ?? ''));
  }

  /** A body's colliders: its owned ones (robot cells) in creation order, else Rapier's (a world box). */
  private collidersOf(id: BodyId): number[] {
    const owned = this.owned.get(id);
    if (owned) return owned;
    const body = this.bodies.get(id);
    if (!body) return [];
    const out: number[] = [];
    for (let i = 0; i < body.numColliders(); i++) out.push(body.collider(i).handle);
    return out;
  }

  /**
   * The manifolds of one collider with everything it touches, each once per pair (keyed by both handles in the pair's
   * own order and the manifold's index), into `into`.
   *
   * Rapier's signs, measured on 0.20 (a box sliding on fixed ground and on a dynamic one, both creation orders; a slab
   * sliding over a jointed car): `normal()` points from the pair's first collider to its second whichever collider
   * asks, `contactImpulse` pushes the second along it, and `contactTangentImpulse` pushes the second along the normal
   * turned a quarter counterclockwise, (-ny, nx). So the impulse is worked out once in the pair's own order.
   */
  private manifoldsOf(handle: number, into: Map<string, ContactImpulse>): void {
    const collider = this.world.getCollider(handle);
    this.world.contactPairsWith(collider, (other) => {
      let index = 0;
      this.world.contactPair(collider, other, (manifold, flipped) => {
        const c1 = flipped ? other : collider;
        const c2 = flipped ? collider : other;
        const key = manifoldKey(c1.handle, c2.handle, index++);
        if (into.has(key)) return;
        const n = manifold.normal();
        let imp = 0;
        let tan = 0;
        for (let i = 0; i < manifold.numContacts(); i++) {
          imp += manifold.contactImpulse(i);
          tan += manifold.contactTangentImpulse(i);
        }
        const points: { x: number; y: number }[] = [];
        let px = 0;
        let py = 0;
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const p = manifold.solverContactPoint(i);
          if (!p) continue;
          points.push({ x: p.x, y: p.y });
          px += p.x;
          py += p.y;
        }
        if (imp === 0 && tan === 0 && points.length === 0) return;
        if (points.length > 0) {
          px /= points.length;
          py /= points.length;
        } else {
          const a = c1.translation();
          const b = c2.translation();
          px = (a.x + b.x) / 2;
          py = (a.y + b.y) / 2;
        }
        const p1 = c1.parent();
        const p2 = c2.parent();
        const body1 = p1 ? this.byHandle.get(p1.handle) : undefined;
        const body2 = p2 ? this.byHandle.get(p2.handle) : undefined;
        if (body1 === undefined || body2 === undefined) return;
        into.set(key, {
          body1,
          owner1: this.owners.get(c1.handle),
          body2,
          owner2: this.owners.get(c2.handle),
          jx: imp * n.x - tan * n.y,
          jy: imp * n.y + tan * n.x,
          px,
          py,
          points,
        });
      });
    });
  }

  /**
   * Crash: every manifold the bodies' colliders were in on the last step (`ContactImpulse`), each pair once whichever
   * side was asked, in a canonical order (body ids, then owners, then the manifold's place in its pair), so nothing
   * depends on which body was asked first. `more` may name more bodies to ask once the first ones are in (bodies
   * whose every contact must be known).
   *
   * A kick step is two Rapier steps (`applyKicks`); the impulses read after the second are the whole step's, a hit in
   * the first substep included (measured on 0.20: they match the bodies' momentum change, where adding the first
   * step's own impulses counted that hit twice).
   */
  contactImpulses(ids: Iterable<BodyId>, more?: (found: Iterable<ContactImpulse>, asked: ReadonlySet<BodyId>) => Iterable<BodyId>): ContactImpulse[] {
    const found = new Map<string, ContactImpulse>();
    const asked = new Set<BodyId>();
    const ask = (list: Iterable<BodyId>): void => {
      for (const id of list) {
        if (asked.has(id)) continue;
        asked.add(id);
        for (const handle of this.collidersOf(id)) this.manifoldsOf(handle, found);
      }
    };
    ask(ids);
    if (more) ask([...more(found.values(), asked)]);
    const out = [...found];
    out.sort(([ka, a], [kb, b]) => a.body1 - b.body1 || a.body2 - b.body2 || compareText(a.owner1 ?? '', b.owner1 ?? '') || compareText(a.owner2 ?? '', b.owner2 ?? '') || compareText(ka, kb));
    return out.map(([, c]) => c);
  }

  /**
   * Titans: where the body's part colliders touched anything on the last step (Rapier's solver contact points, world
   * frame), each with the unit direction the touch pushed the body. Rapier keeps them for multibody links too (it is
   * the contact force events that it leaves out for links). In the order of the body's colliders, then Rapier's
   * contact graph, stable for a given world. Colliders created since the step have none yet.
   */
  contactPoints(id: BodyId): { x: number; y: number; nx: number; ny: number }[] {
    const out: { x: number; y: number; nx: number; ny: number }[] = [];
    for (const handle of this.owned.get(id) ?? []) {
      const collider = this.world.getCollider(handle);
      this.world.contactPairsWith(collider, (other) => {
        this.world.contactPair(collider, other, (manifold, flipped) => {
          // The normal points from the pair's first collider to its second; flipped means ours is the second.
          const n = manifold.normal();
          const sign = flipped ? 1 : -1;
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const p = manifold.solverContactPoint(i);
            if (p) out.push({ x: p.x, y: p.y, nx: sign * n.x, ny: sign * n.y });
          }
        });
      });
    }
    return out;
  }

  /** Owners of every collider that has one, in creation order. */
  colliderOwners(): string[] {
    return [...this.owners.values()];
  }

  createFixedBox(cx: number, cy: number, w: number, h: number, angle = 0): BodyId {
    const id = this.createBody({ x: cx, y: cy, angle, kind: 'fixed' });
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2);
    this.fresh.push({ handle: this.world.createCollider(desc, this.body(id)).handle, r: w / 2 + h / 2, x: NaN, y: NaN });
    return id;
  }

  createDynamicBox(cx: number, cy: number, w: number, h: number, mass: number, angle = 0): BodyId {
    const id = this.createBody({ x: cx, y: cy, angle, kind: 'dynamic' });
    this.addCollider(id, { shape: 'box', hx: w / 2, hy: h / 2 }, { offsetX: 0, offsetY: 0, mass });
    return id;
  }

  /**
   * `world.createCollider(desc, body)` as Rapier 0.20's `ColliderSet.createCollider` does it, with the same call into
   * Rapier and the same values, but keeping the raw shape (one per `shapeKey`), rotation (one per angle) and vectors it
   * would make and free in WASM memory for each collider: a titan's rebuild makes about 2300 colliders, and those
   * allocations were about half of it. The raw objects are only read by Rapier (borrowed), never kept by it.
   */
  private makeCollider(desc: RAPIER.ColliderDesc, body: RAPIER.RigidBody, shapeKey: string): RAPIER.Collider {
    const kit = (this.rawKit ??= { tra: RAPIER.VectorOps.intoRaw({ x: 0, y: 0 }), com: RAPIER.VectorOps.intoRaw({ x: 0, y: 0 }), shapes: new Map(), turns: new Map() });
    const set = this.world.colliders as unknown as { raw: RAPIER.ColliderSet['raw']; map: { set(handle: number, c: RAPIER.Collider): void } };
    const bodies = this.world.bodies;
    let shape = kit.shapes.get(shapeKey);
    if (!shape) {
      shape = desc.shape.intoRaw();
      kit.shapes.set(shapeKey, shape);
    }
    const angle = desc.rotation;
    // -0 kept apart from 0 (a Map takes them as one key): its rotation's sine is -0.
    const turnKey = angle === 0 && 1 / angle < 0 ? '-0' : angle;
    let turn = kit.turns.get(turnKey);
    if (!turn) {
      turn = RAPIER.RotationOps.intoRaw(angle);
      kit.turns.set(turnKey, turn);
    }
    kit.tra.x = desc.translation.x;
    kit.tra.y = desc.translation.y;
    kit.com.x = desc.centerOfMass.x;
    kit.com.y = desc.centerOfMass.y;
    const d = desc;
    const handle = set.raw.createCollider(d.enabled, shape, kit.tra, turn, d.massPropsMode, d.mass, kit.com, d.principalAngularInertia, d.density, d.friction, d.restitution, d.frictionCombineRule, d.restitutionCombineRule, d.isSensor, d.collisionGroups, d.solverGroups, d.activeCollisionTypes, d.activeHooks, d.activeEvents, d.contactForceEventThreshold, d.contactSkin, true, body.handle, bodies.raw) as number;
    const collider = new RAPIER.Collider(this.world.colliders, handle, bodies.get(body.handle), desc.shape);
    set.map.set(handle, collider);
    return collider;
  }

  private body(id: BodyId): RAPIER.RigidBody {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`unknown body ${id}`);
    return body;
  }

  /**
   * Snapshots every body's state for interpolation and the crash check (a waiting kick's velocity counts), adds the
   * motors', drag's and ropes' forces, then advances one fixed step: a kicked body gets its kick in the first substep
   * (`applyKicks`), and the step's other substeps follow.
   */
  step(): void {
    for (const id of this.bodies.keys()) this.prev.set(id, this.state(id));
    // Joint motors: torque min(cap, gain * speed error) on the child and its reaction on the parent. A motor that
    // pushes wakes its bodies, so a wheel held against a wall never falls asleep with the key down.
    for (const j of this.joints.values()) {
      if (j.maxTorque === 0) {
        j.integral = 0;
        continue;
      }
      const p = this.body(j.parent);
      const c = this.body(j.child);
      const rel = this.velocity(j.child, c).w - this.velocity(j.parent, p).w;
      let want: number;
      if (j.kind === 'velocity') want = j.factor * (j.target - rel);
      else {
        const err = wrapAngle(j.target - wrapAngle(c.rotation() - p.rotation()));
        const pd = j.factor * err - j.damping * (rel - j.rate);
        want = pd + j.integral;
        if (j.integralGain > 0) {
          // Batch: the integral term. It builds while off target and bleeds while on it; it stops growing (anti-windup)
          // once the whole torque is at the cap in the direction it would push, and is itself capped to the cap.
          if (Math.abs(err) <= INTEGRAL_DEADBAND) j.integral *= 1 - INTEGRAL_BLEED * this.dt;
          else if (Math.abs(want) < j.maxTorque || want * err < 0) j.integral += j.integralGain * err * this.dt;
          j.integral = Math.max(-j.maxTorque, Math.min(j.maxTorque, j.integral));
          want = pd + j.integral;
        } else j.integral = 0;
      }
      const tau = Math.max(-j.maxTorque, Math.min(j.maxTorque, want));
      if (tau === 0) continue;
      c.addTorque(tau, true);
      p.addTorque(-tau, true);
      this.forced.add(j.parent).add(j.child);
    }
    // Batch: sliding joints. The motor's force on the child and its reaction on the parent, both at the child's
    // origin, so the pair adds no net force or torque to the two bodies together.
    for (const sl of this.sliders.values()) {
      if (sl.maxForce === 0) continue;
      const st = this.sliderState(sl);
      const c = this.body(sl.child);
      const err = sl.target - st.position;
      const feed = -c.mass() * this.gravityY * st.ay;
      const want = sl.stiffness * err + sl.damping * (sl.rate - st.speed) + sl.integral + feed;
      const force = Math.max(-sl.maxForce, Math.min(sl.maxForce, want));
      // The load term only learns while the motor has force to spare.
      if (Math.abs(want) < sl.maxForce || want * err < 0) {
        sl.integral = Math.max(-sl.maxForce, Math.min(sl.maxForce, sl.integral + SLIDER_INTEGRAL_RATE * sl.stiffness * err * this.stepSeconds));
      }
      if (force === 0) continue;
      c.addForceAtPoint({ x: force * st.ax, y: force * st.ay }, { x: st.px, y: st.py }, true);
      this.body(sl.parent).addForceAtPoint({ x: -force * st.ax, y: -force * st.ay }, { x: st.px, y: st.py }, true);
      this.forced.add(sl.parent).add(sl.child);
    }
    for (const [id, handles] of this.owned) {
      const cells = handles.length;
      const b = this.body(id);
      if (b.isSleeping()) continue;
      const v = this.velocity(id, b);
      // sqrt, not hypot: the spec lets engines approximate hypot, and this feeds forces every tick.
      const speed = Math.sqrt(v.x * v.x + v.y * v.y);
      const w = v.w;
      if (speed === 0 && w === 0) continue;
      b.addForce({ x: -AIR_DRAG * cells * speed * v.x, y: -AIR_DRAG * cells * speed * v.y }, false);
      // A wheel spinning on its joint is not tumbling through the air: spin drag is for free bodies only.
      if (!this.jointChildren.has(id)) b.addTorque(-AIR_SPIN_DRAG * cells * Math.abs(w) * w, false);
      this.forced.add(id);
    }
    this.pullRopes();
    if (this.applyKicks()) {
      // The step's other substeps, each as long as usual.
      this.world.timestep = (this.stepSeconds / SOLVER_ITERATIONS) * (SOLVER_ITERATIONS - 1);
      this.world.numSolverIterations = SOLVER_ITERATIONS - 1;
      this.world.step();
      this.world.timestep = this.stepSeconds;
      this.world.numSolverIterations = SOLVER_ITERATIONS;
    } else this.world.step();
    this.fresh = [];
    for (const id of this.forced) {
      const b = this.body(id);
      b.resetForces(false);
      b.resetTorques(false);
    }
    this.forced.clear();
  }

  /** A body's pose and velocity; a waiting kick's velocity until the step that applies it (`kick`). */
  state(id: BodyId): BodyState {
    const s = readState(this.body(id));
    const k = this.kicks.get(id);
    return k ? { ...s, vx: k.vx, vy: k.vy, w: k.w } : s;
  }

  prevState(id: BodyId): BodyState {
    const s = this.prev.get(id);
    if (!s) throw new Error(`unknown body ${id}`);
    return s;
  }

  get bodyIds(): BodyId[] {
    return [...this.bodies.keys()];
  }

  /**
   * Feeds every body's exact state into the hasher in creation order, then the forces waiting for the next step
   * (a kick or a blast push applied between steps shapes the future).
   */
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
    // Batch: a position motor's integral term shapes the future. Added only when nonzero, so other worlds keep their hashes.
    for (const [jointId, j] of this.joints) {
      if (j.integral === 0) continue;
      h.addInt(jointId);
      h.addF64(j.integral);
    }
    for (const id of this.forced) {
      const b = this.body(id);
      const f = b.userForce();
      h.addInt(id);
      h.addF64(f.x);
      h.addF64(f.y);
      h.addF64(b.userTorque());
    }
    // Batch: a slider's learned load shapes the future. Worlds without a slider add nothing.
    for (const sl of this.sliders.values()) h.addF64(sl.integral);
  }

  debugRender(): DebugBuffers {
    const d = this.world.debugRender();
    return { vertices: d.vertices, colors: d.colors };
  }

  free(): void {
    this.world.free();
  }
}
