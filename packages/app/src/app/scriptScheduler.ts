/**
 * Smooth (the Sandbox menu's setting): before each tick the app picks which robots' scripts run, so a fight full of
 * slow scripts holds its frame rate. Robots that do not fit the tick's time budget sit out the tick and keep what
 * their scripts last set (`World.skipScripts`, logged for replays). Pure: the measured costs and the budget come in,
 * the robots to skip go out, so it is testable without a clock. The world never sees any of this but the list.
 */

import type { SettingsStore } from '../world/deploySettings';

const SMOOTH_KEY = 'robots.smooth';

/**
 * Whether Smooth was left on (kept across reloads). Off when nothing is saved, the value is anything but 'on', or
 * storage is blocked. Loading it on changes nothing for replays: the skips it makes are logged like any others.
 */
export function loadSmooth(store: SettingsStore | undefined): boolean {
  try {
    return store?.getItem(SMOOTH_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSmooth(store: SettingsStore | undefined, on: boolean): void {
  try {
    store?.setItem(SMOOTH_KEY, on ? 'on' : 'off');
  } catch {
    // Blocked storage: the setting still holds for this session.
  }
}

/** Every robot's scripts run at least every this many ticks, over budget or not: a missile never flies blind for long. */
export const SMOOTH_FLOOR = 4;

/** How many ticks of each robot the run rate counts before it starts a new count. */
const RATE_WINDOW = 60;

export class ScriptScheduler {
  /** Ticks each robot has sat out in a row. */
  private readonly waited = new Map<number, number>();
  /** Per robot, the count so far and the last full one: ticks it ran, of how many. */
  private readonly counts = new Map<number, { ran: number; of: number; last?: { ran: number; of: number } }>();
  /** Robots skipped on the last tick planned. */
  lastSkipped = 0;
  private readonly floor: number;

  constructor(floor = SMOOTH_FLOOR) {
    this.floor = floor;
  }

  /**
   * Which of `robots` (in the order their scripts run) sit out the next tick. Fair order: those that have waited
   * longest go first (ties keep the robots' order), and each runs if its cost fits what is left of `budgetMs`; one
   * that does not is skipped, and smaller ones after it may still fit. A robot that has sat out `floor - 1` ticks in a
   * row runs whatever it costs. A robot not measured yet runs (its cost is taken as 0). Assumes the skips are applied:
   * it counts them as done. Robots not listed are forgotten.
   */
  plan(robots: readonly number[], cost: (robot: number) => number | undefined, budgetMs: number): number[] {
    const listed = new Set(robots);
    for (const id of [...this.waited.keys()]) if (!listed.has(id)) this.waited.delete(id);
    for (const id of [...this.counts.keys()]) if (!listed.has(id)) this.counts.delete(id);
    const order = robots.map((id, i) => ({ id, i, waited: this.waited.get(id) ?? 0 })).sort((a, b) => b.waited - a.waited || a.i - b.i);
    let left = budgetMs;
    const skip: number[] = [];
    for (const r of order) {
      const c = cost(r.id) ?? 0;
      const runs = r.waited >= this.floor - 1 || c <= left;
      if (runs) left -= c;
      else skip.push(r.id);
      this.waited.set(r.id, runs ? 0 : r.waited + 1);
      const n = this.counts.get(r.id) ?? { ran: 0, of: 0 };
      n.of++;
      if (runs) n.ran++;
      if (n.of >= RATE_WINDOW) {
        n.last = { ran: n.ran, of: n.of };
        n.ran = 0;
        n.of = 0;
      }
      this.counts.set(r.id, n);
    }
    this.lastSkipped = skip.length;
    return skip.sort((a, b) => a - b);
  }

  /** Ticks the robot has sat out in a row. */
  waiting(robot: number): number {
    return this.waited.get(robot) ?? 0;
  }

  /** How often the robot's scripts ran lately: over the last full count, or the one so far before there is one. */
  rate(robot: number): { ran: number; of: number } | undefined {
    const n = this.counts.get(robot);
    if (!n) return undefined;
    if (n.last) return n.last;
    return n.of > 0 ? { ran: n.ran, of: n.of } : undefined;
  }

  clear(): void {
    this.waited.clear();
    this.counts.clear();
    this.lastSkipped = 0;
  }
}

/** A tick is 1/60 s. Smooth plans over at least a tick of real time: it aims for 60 frames a second, not more. */
const TICK_MS = 1000 / 60;
/** Kept free of every frame for the browser (compositing, garbage collection) so a full budget still makes the frame. */
export const SMOOTH_MARGIN_MS = 2;

export interface BudgetIn {
  /** How often the browser gives a frame when the game is not what holds it back (`FramePace`), ms. */
  frameMs: number;
  /** One frame's work outside the sim: syncing views, effects, the UI, and Pixi's draw (smoothed), ms. */
  viewMs: number;
  /** One tick's sim outside scripts (physics, behaviors, damage), smoothed, ms. */
  restMs: number;
  /** Ticks per tick of real time: 4 at 4x. */
  timeScale: number;
}

/** The real time Smooth plans over: a tick, or one frame when the browser gives fewer than 60 a second. */
function windowMs(frameMs: number): number {
  return Math.max(TICK_MS, frameMs);
}

/**
 * Wall-clock ms one frame may spend stepping the sim: the window's real time, less one frame's drawing and the margin.
 * One frame per window: at 60 Hz with 3 ms of drawing that is 11.7 ms, and a browser that gives only 30 frames a
 * second leaves 28.3. A 120 Hz display gets the same 11.7: Smooth aims for 60 frames a second, so the frame with a tick
 * may take the time of two (measured: aiming for 120 put nearly every script at the floor). At least 2.
 */
export function frameSimBudget(b: Pick<BudgetIn, 'frameMs' | 'viewMs'>): number {
  return Math.max(2, windowMs(Math.max(1, b.frameMs)) - SMOOTH_MARGIN_MS - b.viewMs);
}

/** Ticks the window holds at this speed: 4 at 4x and 60 frames a second, 2 at 1x and 30. */
export function ticksPerWindow(b: Pick<BudgetIn, 'frameMs' | 'timeScale'>): number {
  return (b.timeScale * windowMs(Math.max(1, b.frameMs))) / TICK_MS;
}

/**
 * Wall-clock ms the scripts of one tick may take: the frame's sim budget split between the ticks of the window (at
 * least one: slower than 1x, a frame that has a tick still has to fit it), less what the rest of a tick takes. 0 when
 * physics alone fills it: then every script runs only at the floor, and the world slows down as it would without Smooth.
 */
export function scriptBudget(b: BudgetIn): number {
  return Math.max(0, frameSimBudget(b) / Math.max(1, ticksPerWindow(b)) - b.restMs);
}

/**
 * How often the browser gives a frame when the game is not what holds it back: a display's refresh (8.3 ms at 120 Hz),
 * or 33 ms in a browser that holds a window to 30 frames a second (a background window, a laptop saving power). A
 * frame shorter than the estimate always counts (the browser can go that fast). A longer one counts only when its work
 * was well inside a 60 Hz frame (under 60% of a tick): then the browser, not the game, made it late. Otherwise it may
 * be the game's own doing (a frame of 20 ms of work shows as 33 ms on a 60 Hz display), so the estimate drifts down
 * toward a tick: Smooth aims for 60 frames a second rather than settling at a rate it caused.
 */
export class FramePace {
  ms = TICK_MS;

  /** `frameMs`: time since the last frame; `workMs`: what the last frame's work took (sim, views, draw). */
  update(frameMs: number, workMs: number): void {
    const f = Math.min(50, Math.max(4, frameMs));
    if (f < this.ms || workMs < 0.6 * TICK_MS) this.ms += (f - this.ms) * 0.1;
    else if (this.ms > TICK_MS) this.ms += (TICK_MS - this.ms) * 0.02;
  }
}

/** The readout's "runs 1 tick in 3" or "skips 1 tick in 5"; undefined while it runs every tick. */
export function runsText(rate: { ran: number; of: number } | undefined): string | undefined {
  if (!rate || rate.of === 0 || rate.ran >= rate.of) return undefined;
  if (rate.ran * 2 <= rate.of) return `runs 1 tick in ${Math.round(rate.of / Math.max(1, rate.ran))}`;
  return `skips 1 tick in ${Math.round(rate.of / (rate.of - rate.ran))}`;
}
