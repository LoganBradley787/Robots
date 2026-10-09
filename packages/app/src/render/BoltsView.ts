import { Container, Graphics } from 'pixi.js';
import { WIND, type Robot, type World } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen } from './units';
import { interpolateState } from './interpolate';

const WHITE = 0xffffff;
const PALE = 0xd6f4ff;
const BLUE = 0x6fd8ff;
const DEEP = 0x1f8fd6;

/**
 * Charged guns (M15, Logan: "you see it charge up", "its bullet should be light blue"): the glow that builds at a
 * cannon's or a lance's barrel while it charges, steady and bright when full and flickering hard as its hold runs out;
 * and their shots in flight, the cannon's a fat light blue orb with a white heart and a tail, the lance's a long thin
 * white-blue streak. Drawn fresh every frame from the world, with added light. Sizes never go below a few screen
 * pixels, so a shot reads across a whole battle. Cosmetic only: Math.random is fine here.
 */
export class BoltsView {
  readonly root = new Container();
  private readonly glow = new Graphics();
  private clock = 0;

  constructor() {
    this.glow.blendMode = 'add';
    this.root.addChild(this.glow);
  }

  /** `dt` is sim seconds since the last frame (0 while paused), `zoom` the camera's. */
  draw(world: World, alpha: number, dt: number, zoom: number): void {
    this.clock += dt;
    const g = this.glow;
    g.clear();
    const px = 1 / Math.max(zoom, 1e-3) / PIXELS_PER_METER; // one screen pixel, in meters
    for (const robot of world.robots) {
      for (const part of robot.parts.values()) {
        const spec = part.def.cannon;
        const wind = part.wind;
        if (!spec || !wind || wind.level <= 0) continue;
        const end = world.barrelEnd(robot.id, part.id);
        if (!end) continue;
        const shift = drawnShift(world, robot, part.id, alpha);
        const level = Math.min(1, wind.level / spec.charge);
        const full = wind.phase === WIND.full;
        // Held full: how much of its hold is gone. The last third flickers hard (it is about to backfire).
        const held = full ? Math.min(1, (wind.timer * world.dt) / spec.hold) : 0;
        const flick = full ? 1 - (held > 0.66 ? 0.55 : 0.12) * Math.random() : 0.85 + 0.15 * Math.sin(this.clock * (8 + 30 * level));
        const big = spec.width > 0 ? 1.6 : 1;
        const p = toScreen({ x: end.x + shift.x, y: end.y + shift.y });
        const r = (m: number, minPx: number): number => Math.max(m * big, minPx * px) * PIXELS_PER_METER * flick * (0.25 + 0.75 * level);
        g.circle(p.x, p.y, r(2.4, 16)).fill({ color: DEEP, alpha: 0.18 * level });
        g.circle(p.x, p.y, r(1.3, 9)).fill({ color: BLUE, alpha: 0.4 * level });
        g.circle(p.x, p.y, r(0.6, 4)).fill({ color: PALE, alpha: 0.75 * level });
        g.circle(p.x, p.y, r(0.28, 2)).fill({ color: WHITE, alpha: 0.95 * level });
        // Light running up the barrel toward its end as it fills, and motes drawn in to the end.
        const back = { x: end.x + shift.x - end.dx * 3.2 * level, y: end.y + shift.y - end.dy * 3.2 * level };
        const b = toScreen(back);
        g.moveTo(b.x, b.y).lineTo(p.x, p.y).stroke({ color: BLUE, width: Math.max(0.35 * big, 3 * px) * PIXELS_PER_METER, alpha: 0.35 * level * flick, cap: 'round' });
        g.moveTo(b.x, b.y).lineTo(p.x, p.y).stroke({ color: WHITE, width: Math.max(0.12 * big, 1.2 * px) * PIXELS_PER_METER, alpha: 0.7 * level * flick, cap: 'round' });
        if (!full) {
          for (let i = 0; i < 6; i++) {
            // Each mote circles in on its own phase; the clock only advances with the sim, so a pause freezes them.
            const phase = (this.clock * (0.9 + 0.5 * level) + i / 6) % 1;
            const a = i * 2.4 + this.clock * 1.7;
            const d = (1 - phase) * 2.6 * big;
            const m = toScreen({ x: end.x + shift.x + Math.cos(a) * d, y: end.y + shift.y + Math.sin(a) * d });
            g.circle(m.x, m.y, Math.max(0.09 * big, 1.2 * px) * PIXELS_PER_METER).fill({ color: PALE, alpha: 0.8 * phase * level });
          }
        }
      }
    }
    for (const s of [...world.liveBolts(), ...world.spentBolts()]) {
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (v === 0) continue;
      const ux = s.vx / v;
      const uy = s.vy / v;
      const head = toScreen({ x, y });
      const flown = Math.hypot(x - s.px, y - s.py);
      const line = (len: number, width: number, minPx: number, color: number, a: number): void => {
        // Not behind the barrel on the tick it left.
        const l = Math.min(len, flown + 0.5);
        const tail = toScreen({ x: x - ux * l, y: y - uy * l });
        g.moveTo(tail.x, tail.y).lineTo(head.x, head.y).stroke({ color, width: Math.max(width, minPx * px) * PIXELS_PER_METER, alpha: a, cap: 'round' });
      };
      if (s.width > 0) {
        // The orb: as wide as it hits, its light well past that, a tail behind it.
        const rad = s.width / 2;
        const flick = 0.9 + 0.2 * Math.random();
        line(9, rad * 1.6, 5, DEEP, 0.3);
        line(5, rad * 0.9, 3, BLUE, 0.55);
        const r = (m: number, minPx: number): number => Math.max(m, minPx * px) * PIXELS_PER_METER * flick;
        g.circle(head.x, head.y, r(rad * 2.6, 16)).fill({ color: DEEP, alpha: 0.22 });
        g.circle(head.x, head.y, r(rad * 1.5, 10)).fill({ color: BLUE, alpha: 0.5 });
        g.circle(head.x, head.y, r(rad, 6)).fill({ color: PALE, alpha: 0.9 });
        g.circle(head.x, head.y, r(rad * 0.5, 3)).fill({ color: WHITE, alpha: 1 });
      } else {
        // The lance's bolt: a long needle of light.
        line(26, 0.7, 6, DEEP, 0.22);
        line(20, 0.32, 3.2, BLUE, 0.6);
        line(14, 0.12, 1.4, WHITE, 1);
        g.circle(head.x, head.y, Math.max(0.3, 2.5 * px) * PIXELS_PER_METER).fill({ color: WHITE, alpha: 0.9 });
      }
    }
  }

  clear(): void {
    this.glow.clear();
  }
}

/** How far a part's body is drawn from where it is this tick (sprites move between ticks; so must the glow). */
function drawnShift(world: World, robot: Robot, partId: string, alpha: number): { x: number; y: number } {
  const part = robot.parts.get(partId);
  const group = part ? robot.groups[part.group] : undefined;
  if (!group) return { x: 0, y: 0 };
  const now = world.physics.state(group.bodyId);
  const s = interpolateState(world.physics.prevState(group.bodyId), now, alpha);
  return { x: s.x - now.x, y: s.y - now.y };
}
