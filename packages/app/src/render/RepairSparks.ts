import { Container, Graphics } from 'pixi.js';
import type { RepairView, World } from '@robots/sim-core';
import { PIXELS_PER_METER, toScreen, type Vec2 } from './units';
import { interpolateState } from './interpolate';

const ORANGE = 0xff8a1e;
const HOT = 0xffd28a;
/** Sparks running round one part at once, and how fast, m/s. */
const RUNNERS = 5;
const SPEED = 5;
/** How long a runner's streak is, m. */
const STREAK = 0.3;
/** Sparks thrown off a part per second, at most alive at once, how long they last, and how fast they fall, m/s/s. */
const THROWN = 40;
const MAX_FLYING = 300;
const LIFE = 0.45;
const FALL = 14;

interface Flying {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

/** A corner's number: half a cell is the smallest step, so these are whole. */
const key = (x: number, y: number): string => `${x},${y}`;

/**
 * The outline of a part's cells, as a closed loop of points in the world, going round the first way it finds. Worked
 * out in cells from the first one, so a part of any shape gets one line round it. For a part with a hole in it, the
 * loop that holds the first edge.
 */
export function outlineOf(cells: readonly Vec2[], angle: number): Vec2[] {
  const first = cells[0];
  if (!first) return [];
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  const here = cells.map((p) => ({ x: Math.round(c * (p.x - first.x) + n * (p.y - first.y)), y: Math.round(c * (p.y - first.y) - n * (p.x - first.x)) }));
  const filled = new Set(here.map((p) => key(p.x, p.y)));
  // Every edge with nothing on its far side, cell on its left, from corner to corner.
  const next = new Map<string, { x: number; y: number }>();
  for (const p of here) {
    const l = p.x - 0.5;
    const r = p.x + 0.5;
    const b = p.y - 0.5;
    const t = p.y + 0.5;
    if (!filled.has(key(p.x, p.y - 1))) next.set(key(l, b), { x: r, y: b });
    if (!filled.has(key(p.x + 1, p.y))) next.set(key(r, b), { x: r, y: t });
    if (!filled.has(key(p.x, p.y + 1))) next.set(key(r, t), { x: l, y: t });
    if (!filled.has(key(p.x - 1, p.y))) next.set(key(l, t), { x: l, y: b });
  }
  const start = next.keys().next().value;
  if (start === undefined) return [];
  const loop: Vec2[] = [];
  const [sx, sy] = start.split(',').map(Number) as [number, number];
  let at: { x: number; y: number } | undefined = { x: sx, y: sy };
  while (at && loop.length <= next.size) {
    loop.push({ x: first.x + c * at.x - n * at.y, y: first.y + n * at.x + c * at.y });
    at = next.get(key(at.x, at.y));
    if (at && key(at.x, at.y) === start) break;
  }
  return loop;
}

/** The point `along` meters round a closed loop of points. */
function pointOn(loop: readonly Vec2[], along: number): Vec2 {
  let left = along;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as Vec2;
    const b = loop[(i + 1) % loop.length] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    left -= len;
  }
  return loop[0] as Vec2;
}

/**
 * The sparks of a repair job (Logan: orange sparks running round the part's outline, and no part to shoot off): bright
 * streaks round the outline of the part being scrapped, built or healed, throwing off sparks that fall. Drawn fresh
 * every frame from the world's jobs. Cosmetic only: wall-clock time and Math.random are fine here.
 */
export class RepairSparks {
  readonly root = new Container();
  private readonly g = new Graphics();
  private flying: Flying[] = [];
  private clock = 0;

  constructor() {
    this.g.blendMode = 'add';
    this.root.addChild(this.g);
  }

  draw(world: World, alpha: number, dt: number): void {
    this.clock += dt;
    const g = this.g.clear();
    for (const job of world.repairJobs()) this.drawJob(world, job, alpha, dt);
    this.flying = this.flying.filter((f) => (f.t += dt) < LIFE);
    for (const f of this.flying) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy -= FALL * dt;
      const p = toScreen(f);
      const size = 2.5 * (1 - f.t / LIFE) + 0.5;
      g.rect(p.x - size / 2, p.y - size / 2, size, size).fill({ color: ORANGE, alpha: 1 - f.t / LIFE });
    }
  }

  clear(): void {
    this.flying = [];
    this.g.clear();
  }

  private drawJob(world: World, job: RepairView, alpha: number, dt: number): void {
    const now = world.physics.state(job.body);
    const s = interpolateState(world.physics.prevState(job.body), now, alpha);
    const loop = outlineOf(
      job.cells.map((c) => ({ x: c.x + s.x - now.x, y: c.y + s.y - now.y })),
      job.angle,
    );
    if (loop.length < 2) return;
    let length = 0;
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length] as Vec2;
      length += Math.hypot(b.x - a.x, b.y - a.y);
    });
    const g = this.g;
    for (let i = 0; i < RUNNERS; i++) {
      const head = (this.clock * SPEED + (i * length) / RUNNERS) % length;
      const a = toScreen(pointOn(loop, head));
      const b = toScreen(pointOn(loop, (head + length - STREAK) % length));
      g.moveTo(b.x, b.y).lineTo(a.x, a.y).stroke({ color: ORANGE, width: 3, alpha: 0.9 });
      g.circle(a.x, a.y, 0.09 * PIXELS_PER_METER).fill({ color: HOT, alpha: 0.95 });
      if (this.flying.length < MAX_FLYING && Math.random() < (THROWN * dt) / RUNNERS) {
        const p = pointOn(loop, head);
        this.flying.push({ x: p.x, y: p.y, vx: now.vx + (Math.random() - 0.5) * 7, vy: now.vy + Math.random() * 5, t: 0 });
      }
    }
  }
}
