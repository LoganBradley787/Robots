import { Container, Graphics } from 'pixi.js';
import type { RepairView, World } from '@robots/sim-core';
import { toScreen, type Vec2 } from './units';
import { interpolateState } from './interpolate';

const ORANGE = 0xff8a1e;
/** How far apart the dots round a part are, m. */
const SPACING = 0.48;
const WIDTH = 3;
/** How long the closed outline holds before the part is done, s (Logan: a couple of frames). */
const HOLD = 0.07;
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

/** The length of a closed loop of points, m. */
function lengthOf(loop: readonly Vec2[]): number {
  let length = 0;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  });
  return length;
}

/** The stretch of a closed loop from `from` to `to` meters round it, corners included. */
function stretchOf(loop: readonly Vec2[], from: number, to: number): Vec2[] {
  const out = [pointOn(loop, from)];
  let at = 0;
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] as Vec2;
      const b = loop[(i + 1) % loop.length] as Vec2;
      at += Math.hypot(b.x - a.x, b.y - a.y);
      if (at > from && at < to) out.push(b);
    }
  }
  out.push(pointOn(loop, to % lengthOf(loop)));
  return out;
}

/**
 * How much of its outline a job draws, 0 to 1 (Logan: progress you can read). A build or a heal starts from nothing,
 * its dots growing wider until they meet, and holds closed for its last `HOLD`. A scrap is the same backward: the part
 * starts closed and comes apart into dots that shrink away.
 */
export function drawnShare(kind: RepairView['kind'], done: number, seconds: number): number {
  const closing = seconds > HOLD ? Math.min(1, done / (1 - HOLD / seconds)) : 1;
  return kind === 'scrap' ? 1 - done : closing;
}

/**
 * The dashes round a closed loop of `length` m with `share` of it drawn, each a line of points. A whole number of dots
 * fit the loop, so they meet everywhere at once. Each grows from its middle. All of it drawn is one closed line.
 */
export function dashesOf(loop: readonly Vec2[], length: number, share: number): Vec2[][] {
  if (share >= 1) return [[...loop, loop[0] as Vec2]];
  if (share <= 0) return [];
  const count = Math.max(1, Math.round(length / SPACING));
  const period = length / count;
  const out: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    const middle = (i + 0.5) * period;
    out.push(stretchOf(loop, middle - (share * period) / 2, middle + (share * period) / 2));
  }
  return out;
}

/**
 * What a repair job looks like (Logan: no part to shoot off, and you can see how far along it is): a dotted orange
 * outline round the part being scrapped, built or healed, throwing off sparks that fall. Drawn fresh every frame from
 * the world's jobs. Cosmetic only: wall-clock time and Math.random are fine here.
 */
export class RepairSparks {
  readonly root = new Container();
  private readonly g = new Graphics();
  private flying: Flying[] = [];

  constructor() {
    this.g.blendMode = 'add';
    this.root.addChild(this.g);
  }

  draw(world: World, alpha: number, dt: number): void {
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
    const length = lengthOf(loop);
    const g = this.g;
    for (const dash of dashesOf(loop, length, drawnShare(job.kind, job.done, job.seconds))) {
      dash.forEach((p, i) => {
        const at = toScreen(p);
        if (i === 0) g.moveTo(at.x, at.y);
        else g.lineTo(at.x, at.y);
      });
      g.stroke({ color: ORANGE, width: WIDTH, alpha: 0.95 });
    }
    if (this.flying.length < MAX_FLYING && Math.random() < THROWN * dt) {
      const p = pointOn(loop, Math.random() * length);
      this.flying.push({ x: p.x, y: p.y, vx: now.vx + (Math.random() - 0.5) * 7, vy: now.vy + Math.random() * 5, t: 0 });
    }
  }
}
