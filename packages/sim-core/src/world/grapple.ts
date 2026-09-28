import type { BodyId, PhysicsWorld, RopeId } from '../physics/PhysicsWorld';
import type { StateHasher } from '../replay/StateHasher';
import { faceDir, rotateFace } from '../parts/faces';
import type { PartInstance, Robot } from './Robot';
import type { WorldEvent } from './World';

/**
 * Grapples (Batch): a part that fires a hook and ties a rope. The rope is a record here (the two ends, the anchor on
 * the far end, the length) plus a Rapier rope joint between the two bodies, made again whenever either end's robot is
 * rebuilt, since a rebuild replaces every body. Ends are part instances, which survive rebuilds and splits.
 *
 * A rope ends on a part (a robot's, or debris) or on a body (the ground, a loose block): a body end holds while the
 * body exists. The rope is gone when its grapple or its far part is destroyed, or the robot holding it is removed.
 */

/** The far end of a rope: one of a robot's parts (survives its robot being rebuilt), or a body that is nobody's. */
type Target = { part: PartInstance } | { body: BodyId };

export interface Rope {
  grapple: PartInstance;
  target: Target;
  /**
   * Where the rope is tied on the far end, in that body's frame: from the part's cell center for a part, from the
   * body's origin for a body.
   */
  ox: number;
  oy: number;
  /** Meters of rope: the farthest apart its ends can get. */
  length: number;
  /** The robot the grapple was on last time anyone looked, for events. */
  robot: number;
  /** The Rapier joint and what it was made from. Derived, not hashed. */
  joint?: { id: RopeId; a: BodyId; b: BodyId; ax: number; ay: number; bx: number; by: number; length: number };
}

/** What the grapple logic needs of the world. */
export interface GrappleHost {
  physics: PhysicsWorld;
  dt: number;
  tick: number;
  readonly robots: readonly Robot[];
  readonly events: WorldEvent[];
  /** Whether a core is in charge of the robot (a wreck fires nothing). */
  controlled(robot: Robot): boolean;
  /** A part's input this tick. */
  input(robot: Robot, part: PartInstance, name: string): number;
  /** Where the part's barrel ends and which way it points (a unit vector). */
  muzzle(robot: Robot, part: PartInstance): { x: number; y: number; dx: number; dy: number } | undefined;
}

/** Meters a reeling rope may be shorter than the distance it holds: past this the winch waits for the pull to catch up. */
const MAX_STRETCH = 0.25;

/** The end of a rope in world terms: which body, the anchor in its frame, and where that is. */
interface End {
  body: BodyId;
  lx: number;
  ly: number;
  x: number;
  y: number;
}

export class Grapples {
  readonly ropes: Rope[] = [];
  /** Grapples whose `fire` was above 0.5 last tick: a hook flies once per press. Simulation state, hashed. */
  private readonly held = new Set<PartInstance>();

  /** Every live part's robot. */
  private owners(host: GrappleHost): Map<PartInstance, Robot> {
    const owner = new Map<PartInstance, Robot>();
    for (const robot of host.robots) for (const part of robot.parts.values()) owner.set(part, robot);
    return owner;
  }

  /** The grapple end of a rope: the muzzle of its part, or undefined when the part or its body is gone. */
  private near(host: GrappleHost, owner: Map<PartInstance, Robot>, rope: Rope): End | undefined {
    const robot = owner.get(rope.grapple);
    const group = robot?.groups[rope.grapple.group];
    const acts = rope.grapple.def.acts;
    if (!robot || !group || acts === undefined) return undefined;
    const f = faceDir(rotateFace(acts, rope.grapple.rot));
    const lx = rope.grapple.localX + 0.5 * f.x;
    const ly = rope.grapple.localY + 0.5 * f.y;
    return this.end(host, group.bodyId, lx, ly);
  }

  private far(host: GrappleHost, owner: Map<PartInstance, Robot>, rope: Rope): End | undefined {
    if ('body' in rope.target) return host.physics.hasBody(rope.target.body) ? this.end(host, rope.target.body, rope.ox, rope.oy) : undefined;
    const part = rope.target.part;
    const robot = owner.get(part);
    const group = robot?.groups[part.group];
    if (!robot || !group) return undefined;
    return this.end(host, group.bodyId, part.localX + rope.ox, part.localY + rope.oy);
  }

  private end(host: GrappleHost, body: BodyId, lx: number, ly: number): End {
    const s = host.physics.state(body);
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    return { body, lx, ly, x: s.x + c * lx - n * ly, y: s.y + n * lx + c * ly };
  }

  private drop(host: GrappleHost, rope: Rope, why: 'released' | 'lost'): void {
    if (rope.joint) host.physics.removeRope(rope.joint.id);
    rope.joint = undefined;
    const i = this.ropes.indexOf(rope);
    if (i >= 0) this.ropes.splice(i, 1);
    host.events.push({ tick: host.tick, robot: rope.robot, kind: 'unhooked', part: rope.grapple.id, why });
  }

  /** Drops every rope whose grapple or far part is gone or destroyed (health 0 this tick), and notes each grapple's robot. */
  private prune(host: GrappleHost, owner: Map<PartInstance, Robot>): void {
    for (const rope of [...this.ropes]) {
      const robot = owner.get(rope.grapple);
      const targetGone = 'part' in rope.target && (!owner.has(rope.target.part) || rope.target.part.health <= 0);
      if (!robot || rope.grapple.health <= 0 || targetGone || ('body' in rope.target && !host.physics.hasBody(rope.target.body))) {
        this.drop(host, rope, 'lost');
        continue;
      }
      rope.robot = robot.id;
    }
  }

  /**
   * Just before the physics step: every rope has a joint between the bodies that hold its ends right now. A rope whose
   * robot was rebuilt since (its old bodies are gone, and its joint with them) gets a new one; one whose length was
   * changed by reeling gets a joint of that length.
   */
  sync(host: GrappleHost): void {
    if (this.ropes.length === 0) return;
    const owner = this.owners(host);
    this.prune(host, owner);
    for (const rope of this.ropes) {
      const a = this.near(host, owner, rope);
      const b = this.far(host, owner, rope);
      if (!a || !b) continue;
      const j = rope.joint;
      if (a.body === b.body) {
        // Both ends on one body (a piece broke off with the hook's target): nothing to hold.
        if (j) host.physics.removeRope(j.id);
        rope.joint = undefined;
        continue;
      }
      if (j && host.physics.ropeAlive(j.id) && j.a === a.body && j.b === b.body && j.ax === a.lx && j.ay === a.ly && j.bx === b.lx && j.by === b.ly && j.length === rope.length) continue;
      if (j) host.physics.removeRope(j.id);
      const id = host.physics.createRope(a.body, b.body, { x: a.lx, y: a.ly }, { x: b.lx, y: b.ly }, rope.length);
      rope.joint = { id, a: a.body, b: b.body, ax: a.lx, ay: a.ly, bx: b.lx, by: b.ly, length: rope.length };
    }
  }

  /**
   * Right after the physics step (the same time guns look, so the query index is fresh): each grapple reads its inputs.
   * `release` drops its rope. `fire` rising above 0.5 casts a ray out of the barrel (up to `reach`) and ties a rope to the
   * first thing it hits that is not the grapple's own robot: the distance to it is the rope's length. Terrain and loose
   * bodies count: a hook in the ground is an anchor to swing on. `fire` while hooked does nothing until the rope is
   * released; `release` and `fire` on one tick release. `reel` (positive pulls in) shortens the rope at up to
   * `reelSpeed` m/s, first taking up any slack; negative pays it out.
   */
  run(host: GrappleHost): void {
    const grapples: { robot: Robot; part: PartInstance }[] = [];
    for (const robot of host.robots) for (const part of robot.parts.values()) if (part.def.grapple !== undefined) grapples.push({ robot, part });
    if (grapples.length === 0 && this.ropes.length === 0 && this.held.size === 0) return;
    const owner = this.owners(host);
    this.prune(host, owner);
    const present = new Set(grapples.map((g) => g.part));
    for (const part of this.held) if (!present.has(part)) this.held.delete(part);
    const bodies = new Map<BodyId, Robot>();
    for (const robot of host.robots) for (const g of robot.groups) bodies.set(g.bodyId, robot);
    for (const { robot, part } of grapples) {
      const spec = part.def.grapple;
      if (!spec) continue;
      const fire = host.input(robot, part, 'fire') > 0.5;
      const wasHeld = this.held.has(part);
      if (fire) this.held.add(part);
      else this.held.delete(part);
      let rope = this.ropes.find((r) => r.grapple === part);
      if (rope && host.input(robot, part, 'release') > 0.5) {
        this.drop(host, rope, 'released');
        rope = undefined;
        continue;
      }
      if (!rope && fire && !wasHeld && part.health > 0 && host.controlled(robot)) this.cast(host, robot, part, bodies);
      else if (rope) this.reel(host, owner, rope, host.input(robot, part, 'reel'));
    }
  }

  private cast(host: GrappleHost, robot: Robot, part: PartInstance, bodies: Map<BodyId, Robot>): void {
    const spec = part.def.grapple;
    const m = host.muzzle(robot, part);
    if (!spec || !m) return;
    const hit = host.physics.castRay(m.x, m.y, m.dx, m.dy, spec.reach, (b) => bodies.get(b) === robot);
    if (!hit) return;
    const hitRobot = bodies.get(hit.body);
    const hitPart = hit.owner === undefined ? undefined : hitRobot?.parts.get(hit.owner);
    const s = host.physics.state(hit.body);
    const px = m.x + m.dx * hit.distance - s.x;
    const py = m.y + m.dy * hit.distance - s.y;
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    // The hit point in the body's frame.
    const lx = c * px + n * py;
    const ly = -n * px + c * py;
    const live = hitPart !== undefined && hitPart.health > 0;
    const length = Math.min(spec.maxLength, Math.max(spec.minLength, hit.distance));
    this.ropes.push({
      grapple: part,
      target: live ? { part: hitPart } : { body: hit.body },
      ox: live ? lx - hitPart.localX : lx,
      oy: live ? ly - hitPart.localY : ly,
      length,
      robot: robot.id,
    });
    host.events.push({ tick: host.tick, robot: robot.id, kind: 'hooked', part: part.id, to: live ? (hitRobot?.id ?? 0) : 0, length });
  }

  private reel(host: GrappleHost, owner: Map<PartInstance, Robot>, rope: Rope, reel: number): void {
    const spec = rope.grapple.def.grapple;
    if (!spec || reel === 0) return;
    const step = Math.max(-1, Math.min(1, reel)) * spec.reelSpeed * host.dt;
    let length = rope.length - step;
    if (reel > 0) {
      // A winch takes up slack first: the rope pulls the moment it is reeled in. And it never runs ahead of the pull:
      // a rope can close only so fast on something heavy, and a rope reeled tighter than that only stretches.
      const a = this.near(host, owner, rope);
      const b = this.far(host, owner, rope);
      if (a && b) {
        const d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        length = Math.min(rope.length, Math.max(Math.min(rope.length, d) - step, d - MAX_STRETCH));
      }
    }
    rope.length = Math.min(spec.maxLength, Math.max(spec.minLength, length));
  }

  /** A grapple's outputs: `hooked` (0 or 1) and `length` (meters of rope, 0 without one). */
  output(part: PartInstance, name: string): number | undefined {
    const rope = this.ropes.find((r) => r.grapple === part);
    if (name === 'hooked') return rope ? 1 : 0;
    if (name === 'length') return rope?.length ?? 0;
    return undefined;
  }

  /** Every rope's two ends in the world, for drawing. Read only. */
  segments(host: GrappleHost): { x1: number; y1: number; x2: number; y2: number; taut: boolean }[] {
    if (this.ropes.length === 0) return [];
    const owner = this.owners(host);
    const out: { x1: number; y1: number; x2: number; y2: number; taut: boolean }[] = [];
    for (const rope of this.ropes) {
      const a = this.near(host, owner, rope);
      const b = this.far(host, owner, rope);
      if (!a || !b) continue;
      const d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, taut: d >= rope.length - 0.05 });
    }
    return out;
  }

  /** Ropes and held triggers shape the future. Adds nothing when there are none, so worlds without grapples hash as before. */
  hashInto(h: StateHasher, host: GrappleHost): void {
    if (this.ropes.length === 0 && this.held.size === 0) return;
    const owner = this.owners(host);
    h.addString('grapples');
    h.addInt(this.ropes.length);
    for (const rope of this.ropes) {
      h.addInt(owner.get(rope.grapple)?.id ?? 0);
      h.addString(rope.grapple.id);
      if ('part' in rope.target) {
        h.addInt(owner.get(rope.target.part)?.id ?? 0);
        h.addString(rope.target.part.id);
      } else {
        h.addString('body');
        h.addInt(rope.target.body);
      }
      h.addF64(rope.ox);
      h.addF64(rope.oy);
      h.addF64(rope.length);
    }
    h.addInt(this.held.size);
    for (const part of this.held) {
      h.addInt(owner.get(part)?.id ?? 0);
      h.addString(part.id);
    }
  }
}
