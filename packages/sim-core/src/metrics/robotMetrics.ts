import type { Robot } from '../world/Robot';
import type { World } from '../world/World';

export interface RobotSample {
  tick: number;
  time: number;
  /** World position of the core (or the root part of a core-less robot). */
  coreX: number;
  coreY: number;
  /** Angle of the core's body in degrees, in (-180, 180]. */
  tiltDeg: number;
  /** Linear speed of the core's body, m/s. */
  speed: number;
  massKg: number;
  comX: number;
  comY: number;
  /** Every body of the robot is nearly still. */
  resting: boolean;
  bodies: number;
  parts: number;
  chunks: number;
}

const REST_SPEED = 0.05;
const REST_SPIN = 0.05;

/** World pose of a part's cell center. Reporting only: never fed back into the sim. */
export function partWorldPose(world: World, robot: Robot, partId: string): { x: number; y: number; angle: number } {
  const part = robot.parts.get(partId);
  const group = part ? robot.groups[part.group] : undefined;
  if (!part || !group) throw new Error(`robot ${robot.name} has no part ${partId}`);
  const s = world.physics.state(group.bodyId);
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.x + c * part.localX - n * part.localY, y: s.y + n * part.localX + c * part.localY, angle: s.angle };
}

function degrees(rad: number): number {
  let d = (rad * 180) / Math.PI;
  d %= 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d + 0;
}

export function sampleRobot(world: World, robot: Robot): RobotSample {
  const anchorId = robot.primaryCoreId ?? robot.rootId;
  const pose = partWorldPose(world, robot, anchorId);
  const anchorGroup = robot.groups[robot.parts.get(anchorId)?.group ?? 0];
  const anchorState = world.physics.state(anchorGroup?.bodyId ?? 0);
  let mass = 0;
  let mx = 0;
  let my = 0;
  let resting = true;
  for (const g of robot.groups) {
    const mp = world.physics.massProperties(g.bodyId);
    mass += mp.mass;
    mx += mp.mass * mp.comX;
    my += mp.mass * mp.comY;
    const s = world.physics.state(g.bodyId);
    if (Math.hypot(s.vx, s.vy) >= REST_SPEED || Math.abs(s.w) >= REST_SPIN) resting = false;
  }
  return {
    tick: world.tick,
    time: world.time,
    coreX: pose.x,
    coreY: pose.y,
    tiltDeg: degrees(pose.angle),
    speed: Math.hypot(anchorState.vx, anchorState.vy),
    massKg: mass,
    comX: mass > 0 ? mx / mass : pose.x,
    comY: mass > 0 ? my / mass : pose.y,
    resting,
    bodies: robot.groups.length,
    parts: robot.parts.size,
    chunks: robot.chunks.length,
  };
}

/** Summary of a drive for the headless runner (`06` M3): how far, how high, how tilted, how fast. */
export interface DriveMetrics {
  /** Core x at the end minus core x at the first sample, meters. */
  distance: number;
  /** Highest core y seen (ground surface is 0). */
  maxAltitude: number;
  /** Largest absolute core tilt seen, degrees. */
  maxTiltDeg: number;
  topSpeed: number;
}

/** Accumulates DriveMetrics from one sample per tick. */
export class DriveTracker {
  private firstX: number | undefined;
  private lastX = 0;
  private maxY = Number.NEGATIVE_INFINITY;
  private maxTilt = 0;
  private maxSpeed = 0;

  add(s: RobotSample): void {
    this.firstX ??= s.coreX;
    this.lastX = s.coreX;
    this.maxY = Math.max(this.maxY, s.coreY);
    this.maxTilt = Math.max(this.maxTilt, Math.abs(s.tiltDeg));
    this.maxSpeed = Math.max(this.maxSpeed, s.speed);
  }

  result(): DriveMetrics {
    return { distance: this.lastX - (this.firstX ?? this.lastX), maxAltitude: this.maxY, maxTiltDeg: this.maxTilt, topSpeed: this.maxSpeed };
  }
}
