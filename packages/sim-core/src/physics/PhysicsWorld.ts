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

export class PhysicsWorld {
  /** Gravity's y (m/s^2, negative is down), for things that feed it forward (Batch: the piston). */
  readonly gravityY: number;
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RAPIER.RigidBody>();
  private readonly prev = new Map<BodyId, BodyState>();
  /** Bodies that hang on a joint (wheels): no spin drag. */
  private readonly jointChildren = new Set<BodyId>();
  /** Robot cells (owned colliders) per body, for air drag. */
  private readonly cells = new Map<BodyId, number>();
  /** Bodies with forces or torques added for the next step; cleared after it. */
  private readonly forced = new Set<BodyId>();
  private readonly joints = new Map<JointId, JointEntry>();
  /** Batch: sliding joints (pistons), by joint id. Empty in worlds without one, which then hash as before. */
  private readonly sliders = new Map<JointId, SliderEntry>();
  /** Rapier body handle to our id, for mapping colliders back to bodies. */
  private readonly byHandle = new Map<number, BodyId>();
  /** Rapier colliders carry no user data, so owners (part ids) live here, keyed by the opaque handle. */
  private readonly owners = new Map<number, string>();
  /** Invisible bodies that exist for another body (its multibody root, its joint pivot), removed with it. */
  private readonly helpers = new Map<BodyId, BodyId[]>();
  private nextId: BodyId = 1;
  private nextJointId: JointId = 1;

  constructor(gravityY: number, dt: number) {
    this.gravityY = gravityY;
    this.world = new RAPIER.World({ x: 0, y: gravityY });
    this.world.timestep = dt;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this.world.numInternalPgsIterations = INTERNAL_PGS_ITERATIONS;
  }

  /** The fixed step, seconds. */
  get dt(): number {
    return this.world.timestep;
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
    const collider = this.world.createCollider(desc, this.body(bodyId));
    if (owner !== undefined) {
      this.owners.set(collider.handle, owner);
      this.cells.set(bodyId, (this.cells.get(bodyId) ?? 0) + 1);
    }
  }

  /** Removes a body with its colliders, its joints, and its helper bodies. */
  removeBody(id: BodyId): void {
    for (const h of this.helpers.get(id) ?? []) this.removeBody(h);
    this.helpers.delete(id);
    const body = this.body(id);
    for (let i = 0; i < body.numColliders(); i++) {
      const handle = body.collider(i).handle;
      this.owners.delete(handle);
    }
    for (const [jointId, j] of this.joints) if (j.parent === id || j.child === id) this.joints.delete(jointId);
    for (const [jointId, j] of this.sliders) if (j.parent === id || j.child === id) this.sliders.delete(jointId);
    this.byHandle.delete(body.handle);
    this.world.removeRigidBody(body);
    this.bodies.delete(id);
    this.prev.delete(id);
    this.jointChildren.delete(id);
    this.cells.delete(id);
    this.forced.delete(id);
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
    const weld = this.world.createMultibodyJoint(RAPIER.JointData.fixed({ x: 0, y: 0 }, angle, { x: 0, y: 0 }, 0), this.body(root), this.body(id), true);
    weld.setContactsEnabled(false);
  }

  private addHelper(owner: BodyId, helper: BodyId): void {
    const list = this.helpers.get(owner) ?? [];
    list.push(helper);
    this.helpers.set(owner, list);
  }

  /**
   * Gives a body a velocity for the next step: its center of mass moves at (vx, vy) and it turns at w. Applied as a
   * one-step force and torque, because Rapier ignores velocity writes on multibody links (spike, M6). Rapier reports
   * a link's new velocity one step late; positions move with it from the first step.
   */
  kick(id: BodyId, vx: number, vy: number, w: number): void {
    const body = this.body(id);
    const v = body.linvel();
    const m = body.mass();
    body.addForce({ x: (m * (vx - v.x)) / this.world.timestep, y: (m * (vy - v.y)) / this.world.timestep }, true);
    body.addTorque((body.principalInertia() * (w - body.angvel())) / this.world.timestep, true);
    this.forced.add(id);
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
    const c = Math.cos(p.angle);
    const n = Math.sin(p.angle);
    // The pivot's spot in the parent's frame: the anchor plus the slide (turned from the child's rest frame into the parent's).
    const cr = Math.cos(relAngle);
    const sr = Math.sin(relAngle);
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
    this.joints.set(id, { parent, child, kind: 'velocity', factor: motor?.factor ?? 0, damping: 0, target: motor?.targetVelocity ?? 0, rate: 0, maxTorque: motor?.maxTorque ?? 0 });
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
    const ax = Math.cos(ca) * s.axis.x - Math.sin(ca) * s.axis.y;
    const ay = Math.sin(ca) * s.axis.x + Math.cos(ca) * s.axis.y;
    const pt = p.translation();
    const pa = p.rotation();
    const anchorX = pt.x + Math.cos(pa) * s.anchorParent.x - Math.sin(pa) * s.anchorParent.y;
    const anchorY = pt.y + Math.sin(pa) * s.anchorParent.x + Math.cos(pa) * s.anchorParent.y;
    const position = (ct.x - anchorX) * ax + (ct.y - anchorY) * ay;
    // Velocity of each body at the child's origin: linear plus spin about the center of mass.
    const cc = c.worldCom();
    const pc = p.worldCom();
    const cv = c.linvel();
    const pv = p.linvel();
    const cw = c.angvel();
    const pw = p.angvel();
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
   * how fast the target is moving (rad/s), 0 to hold still.
   */
  setPositionMotor(jointId: JointId, targetAngle: number, stiffness: number, damping: number, maxTorque: number, rate = 0): void {
    const entry = this.joint(jointId);
    entry.kind = 'position';
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
   * `margin` so resting exactly against something counts as free.
   * Tests every collider directly rather than through Rapier's scene queries: in 0.20 the query index only
   * refreshes during a step, so it misses colliders created since (a robot just spawned, or a world that is paused).
   */
  overlapsShapes(shapes: readonly { x: number; y: number; shape: ShapeSpec }[], margin = 0.02): boolean {
    const shrink = (v: number): number => Math.max(0.001, v - margin);
    const probes = shapes.map((s) => ({
      pos: { x: s.x, y: s.y },
      shape: s.shape.shape === 'box' ? new RAPIER.Cuboid(shrink(s.shape.hx), shrink(s.shape.hy)) : new RAPIER.Ball(shrink(s.shape.radius)),
    }));
    // The box around every probe: a collider whose bounding circle misses it cannot touch any probe, so the exact
    // test (the slow part, with hundreds of robots about) runs only on colliders near the spot.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      const hx = s.shape.shape === 'box' ? s.shape.hx : s.shape.radius;
      const hy = s.shape.shape === 'box' ? s.shape.hy : s.shape.radius;
      minX = Math.min(minX, s.x - hx);
      minY = Math.min(minY, s.y - hy);
      maxX = Math.max(maxX, s.x + hx);
      maxY = Math.max(maxY, s.y + hy);
    }
    let hit = false;
    this.world.forEachCollider((c) => {
      if (hit) return;
      const pos = c.translation();
      const type = c.shapeType();
      const reach = type === RAPIER.ShapeType.Ball ? c.radius() : type === RAPIER.ShapeType.Cuboid ? Math.hypot(c.halfExtents()?.x ?? Infinity, c.halfExtents()?.y ?? Infinity) : Infinity;
      if (pos.x + reach < minX || pos.x - reach > maxX || pos.y + reach < minY || pos.y - reach > maxY) return;
      const rot = c.rotation();
      hit = probes.some((p) => c.shape.intersectsShape(pos, rot, p.shape, p.pos, 0));
    });
    return hit;
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
    return out.sort((a, b) => a.distance - b.distance || a.body - b.body || (a.owner ?? '').localeCompare(b.owner ?? ''));
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
    // Joint motors: torque min(cap, gain * speed error) on the child and its reaction on the parent. A motor that
    // pushes wakes its bodies, so a wheel held against a wall never falls asleep with the key down.
    for (const j of this.joints.values()) {
      if (j.maxTorque === 0) continue;
      const p = this.body(j.parent);
      const c = this.body(j.child);
      const rel = c.angvel() - p.angvel();
      const want = j.kind === 'velocity' ? j.factor * (j.target - rel) : j.factor * wrapAngle(j.target - wrapAngle(c.rotation() - p.rotation())) - j.damping * (rel - j.rate);
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
        sl.integral = Math.max(-sl.maxForce, Math.min(sl.maxForce, sl.integral + SLIDER_INTEGRAL_RATE * sl.stiffness * err * this.world.timestep));
      }
      if (force === 0) continue;
      c.addForceAtPoint({ x: force * st.ax, y: force * st.ay }, { x: st.px, y: st.py }, true);
      this.body(sl.parent).addForceAtPoint({ x: -force * st.ax, y: -force * st.ay }, { x: st.px, y: st.py }, true);
      this.forced.add(sl.parent).add(sl.child);
    }
    for (const [id, cells] of this.cells) {
      const b = this.body(id);
      if (b.isSleeping()) continue;
      const v = b.linvel();
      // sqrt, not hypot: the spec lets engines approximate hypot, and this feeds forces every tick.
      const speed = Math.sqrt(v.x * v.x + v.y * v.y);
      const w = b.angvel();
      if (speed === 0 && w === 0) continue;
      b.addForce({ x: -AIR_DRAG * cells * speed * v.x, y: -AIR_DRAG * cells * speed * v.y }, false);
      // A wheel spinning on its joint is not tumbling through the air: spin drag is for free bodies only.
      if (!this.jointChildren.has(id)) b.addTorque(-AIR_SPIN_DRAG * cells * Math.abs(w) * w, false);
      this.forced.add(id);
    }
    this.world.step();
    for (const id of this.forced) {
      const b = this.body(id);
      b.resetForces(false);
      b.resetTorques(false);
    }
    this.forced.clear();
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
