export type Face = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;

export interface FootprintCell {
  x: number;
  y: number;
  /** Faces that accept attachment at rotation 0. */
  faces: Face[];
  /**
   * M12: faces that hold whatever touches them only while the part is holding (`PartInstance.holding`): a fabricator
   * bay's inner faces grip what it built, and let go of it all at once. Not also listed in `faces`.
   */
  grips?: Face[];
}

export interface ChannelDef {
  name: string;
  min: number;
  max: number;
  default: number;
}

/**
 * A part that is its own rigid body, joined to the part across its mount face. Parts attached through its other
 * faces ride on its body (a rotator's turret). The motor settings belong to the joint; the behavior maps channels to
 * motor targets.
 */
export interface JointSpec {
  kind: 'revolute';
  mountFace: Face;
  /**
   * `velocity` (wheel): spins at a target speed; a velocity joint part attaches only through its mount face.
   * `position` (rotator, M6): holds a target angle, gains set by its behavior each tick.
   */
  motor: 'velocity' | 'position';
  /** Torque cap in N m. The motor is force based, so heavy robots need stronger motors. */
  maxTorque: number;
  /** Velocity gain: torque per rad/s of error, before the cap. Velocity motors only (0 for position motors). */
  motorFactor: number;
}

/** Default is a box filling the footprint. */
export interface ColliderSpec {
  shape: 'box' | 'ball';
  radius?: number;
  friction?: number;
}

export interface SpriteSpec {
  /** Frame in the parts sheet, drawn at rotation 0 and rotated with the part. */
  frame: string;
  /** For joint parts: drawn on the parent body at the joint, so it does not spin with the part. */
  mountFrame?: string;
  /** Looping animation in the fx sheet (propeller spin). */
  animation?: string;
  /** Overlay animation in the fx sheet shown while the part acts (thruster flame). */
  overlay?: string;
  /** M10: drawn instead of `frame` while the part is armed (a part with `arming`). */
  armedFrame?: string;
  /** M11: drawn instead of `frame` while the part burns (a part with `decoy`). */
  litFrame?: string;
  /**
   * M12: a stretchy cup is drawn cell by cell from these one-cell frames (left side; the right side is them flipped):
   * `floor` under the hollow, `corner` below a wall, `wall`, `mouth` (a wall's top cell), `back` behind the hollow.
   * `frame` stays its palette icon.
   */
  tiles?: { floor: string; corner: string; wall: string; mouth: string; back: string };
}

export interface ResourceSpec {
  kind: string;
  capacity: number;
}

/**
 * A blast (`03`, Explosions): `damage` at the center falling linearly to 0 at `radius` (meters), halved by every part
 * or terrain box in the way; and a push of `push` N s per cell at the center falling to 0 at `pushRadius`, directed
 * away from a point `lift` meters below the center (up and out).
 */
export interface ExplodeSpec {
  radius: number;
  damage: number;
  pushRadius: number;
  push: number;
  lift: number;
}

/**
 * A sensor (M8): it sees robots whose reference point (a live core, else the center of mass) is within `range` meters
 * and inside a `cone` of that many degrees around the part's `acts` face (360: all around), with no terrain between.
 */
export interface SensorSpec {
  cone: number;
  range: number;
}

/** A part that breaks when a hit stops its body by more than `speed` m/s within one step (a warhead's fuze). */
export interface ImpactSpec {
  speed: number;
}

/**
 * How a part joins auto controls (`11`): `axis` parts get `keys[0]` at the channel max and `keys[1]` at its min on
 * `channel` (wheels: D and A, whatever their rotation; gyro: E and Q); `push` parts get the key for the direction they
 * push after rotation (up W, down S, right D, left A).
 */
export interface AutoControlSpec {
  channel: string;
  kind: 'axis' | 'push';
  /** Axis keys, positive then negative. Default D, A. */
  keys?: [string, string];
  /** How the builder describes the two axis directions. Default forward, reverse. */
  labels?: [string, string];
}

/**
 * A decoy (M11, a flare): once its `ignite` input goes above 0.5 it burns for `burn` seconds, then is gone. While it
 * burns, every sensor that sees it takes it for the robot it was part of when it was lit (`03`, `04`: contacts).
 */
export interface DecoySpec {
  burn: number;
}

/**
 * A gun (M13): while its `fire` input is above 0.5 it fires `rate` shells a second out of its `acts` face at `speed`
 * m/s (plus its own motion), each pushing it back `recoil` N s. A shell falls under gravity, takes `damage` off the
 * first part it hits (anyone's) and pushes it `recoil` N s, stops on terrain, and is gone after `life` seconds. Its
 * sight looks `range` meters straight out of the barrel: what it would hit first (the `sight`, `sightSide`, `sightId`
 * outputs), and `aim`, the barrel's world angle.
 */
export interface GunSpec {
  speed: number;
  damage: number;
  rate: number;
  life: number;
  recoil: number;
  range: number;
}

/**
 * A solar panel (Batch): while its `acts` face points up it adds `power` J/s to its chunk's energy pool, scaled by the
 * cosine of the angle between that face and straight up (0 when it points level or down). It fills the chunk's energy
 * containers up to capacity; a panel with nothing to fill makes nothing.
 */
export interface SolarSpec {
  power: number;
}

/**
 * A fabricator (M12): it builds copies of a blueprint (the part's `makes`) inside its hollow, out of its robot's
 * energy: `joulesPerKg` of the copy's mass plus what its containers hold, over `secondsPerKg` of its mass. Its grips
 * hold the finished copy until its `release` input lets it go, pushed out along `acts` with `separation` N s.
 */
export interface FabricateSpec {
  joulesPerKg: number;
  secondsPerKg: number;
  separation: number;
}

/**
 * M12 (Logan: a bay's size is set where it is placed): the part stretches. `cup` is a U open on its `acts` face (N at
 * rotation 0): a floor one cell thick, walls one cell thick, a hollow `size` wide and tall, the floor cells under the
 * hollow and the walls' inner faces are grips. Its footprint in the def is its default size; `min` and `max` bound
 * the hollow; its mass is `massPerCell` times its cells.
 */
export interface StretchSpec {
  shape: 'cup';
  min: [number, number];
  max: [number, number];
  massPerCell: number;
}

export interface PartDef {
  id: string;
  name: string;
  footprint: FootprintCell[];
  mass: number;
  health: number;
  symmetry: 1 | 2 | 4;
  inputs: ChannelDef[];
  outputs: ChannelDef[];
  powerDraw: number;
  /** `core`: a control brain. Bindings and scripts attach to cores, and the primary core roots a robot. */
  role?: 'core';
  behavior?: string;
  behaviorConfig?: Record<string, number>;
  /** The direction the part acts (thrust, lift) at rotation 0, as a face. Rotates with the part. */
  acts?: Face;
  autoControl?: AutoControlSpec;
  joint?: JointSpec;
  collider?: ColliderSpec;
  resource?: ResourceSpec;
  onDestroyed?: { explode?: ExplodeSpec };
  impact?: ImpactSpec;
  /**
   * M10: the part is safe until armed. It needs an `arm` input (above 0.5 arms it for good) and an `armed` output.
   * Unarmed, `onDestroyed.explode` and `impact` do not apply, and its behavior may ignore its triggers (a warhead's
   * `detonate`). A blueprint can start it armed (`armed: true`).
   */
  arming?: boolean;
  sensor?: SensorSpec;
  /** M11: the part is a decoy (a flare). It needs an `ignite` input and a `burning` output. */
  decoy?: DecoySpec;
  /** M13: the part is a gun. It needs `acts`, a `fire` input, and `sight`, `sightSide`, `sightId`, and `aim` outputs. */
  gun?: GunSpec;
  /** Batch: the part is a solar panel. It needs `acts`. */
  solar?: SolarSpec;
  /** M12: the part's size is set per placement (`size` on the placed part). */
  stretch?: StretchSpec;
  /** M12: the part builds things (a fabricator bay). It needs grips, `acts`, a `release` input, and `ready`, `progress`, and `built` outputs. */
  fabricate?: FabricateSpec;
  sprite: SpriteSpec;
  defaultTags?: string[];
}
