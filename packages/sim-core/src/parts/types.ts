export type Face = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;

export interface FootprintCell {
  x: number;
  y: number;
  /** Faces that accept attachment at rotation 0. */
  faces: Face[];
}

export interface ChannelDef {
  name: string;
  min: number;
  max: number;
  default: number;
}

/**
 * A part that is its own rigid body, joined to the part across its mount face, which must be its only
 * attachable face. The motor settings belong to the joint; the behavior maps channels to motor targets.
 */
export interface JointSpec {
  kind: 'revolute';
  mountFace: Face;
  /** Only velocity motors exist so far. Position motors arrive with the rotator (M6). */
  motor: 'velocity';
  /** Torque cap in N m. The motor is force based, so heavy robots need stronger motors. */
  maxTorque: number;
  /** Velocity gain: torque per rad/s of error, before the cap. */
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
}

export interface ResourceSpec {
  kind: string;
  capacity: number;
}

export interface ExplodeSpec {
  radius: number;
  impulseRadius: number;
  impulse: number;
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
  joint?: JointSpec;
  collider?: ColliderSpec;
  resource?: ResourceSpec;
  onDestroyed?: { explode?: ExplodeSpec };
  sprite: SpriteSpec;
  defaultTags?: string[];
}
