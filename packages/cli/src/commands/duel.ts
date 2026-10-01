import { resolve } from 'node:path';
import { orientRaw, parseWorldFile, partCells, partWorldPose, rootPartId, validateBlueprint, World, type PartInstance, type Robot, type WorldFile, type WorldOptions } from '@robots/sim-core';
import { readJson, REPO_ROOT } from '../blueprintFiles';
import { scriptHost } from '../scriptHost';
import { timedHost } from '../timedHost';
import { InvalidBlueprint } from './run';

/** The rules of a match (docs/plans/titans-tournament.md). */
export const ARENA_WORLD = resolve(REPO_ROOT, 'worlds/arena.json');
/** How far from the middle each main core spawns, meters: a on the left, b on the right. */
export const DUEL_X = 400;
/** The highest a main core may spawn, meters. */
export const MAX_SPAWN_Y = 150;
/** A main core past x -x or +x, or above y, has lost. */
export interface Bounds {
  x: number;
  y: number;
}
export const DEFAULT_BOUNDS: Bounds = { x: 1000, y: 250 };
/** The match runs on this long after the first loss, seconds; the other side losing in that time makes it a draw. */
export const GRACE_SECONDS = 2;

export interface DuelEntry {
  /** What the robot is called in the report: the name it was asked for by. */
  name: string;
  /** The blueprint as read from its file, facing right; b is flipped here. */
  raw: unknown;
  /** The main core's spawn height; resting on the ground when absent. */
  y?: number;
}

export interface DuelOptions {
  seed: number;
  seconds: number;
  /** The world in place of the arena. */
  file?: WorldFile;
  /** The bounds in place of DEFAULT_BOUNDS; false for none. */
  bounds?: Bounds | false;
  /** Seconds between rows of the report (default 10). */
  sampleEverySeconds?: number;
  /** Tests: half the distance between the main cores in place of DUEL_X. */
  x?: number;
  /** Tests: a script host in place of the default. */
  world?: Pick<WorldOptions, 'scripts' | 'scriptProbe'>;
}

export type Side = 'a' | 'b';

export interface SideCount {
  /** Starting cores still alive (the main core and any others, such as those of its starting missiles). */
  cores: number;
  /** Starting parts still alive, wherever they are now. */
  parts: number;
  /** `parts` over the starting count less the starting parts that ended themselves (blasted or burnt out). Tells how much is left; decides nothing. */
  share: number;
  /** Robots of this side's team with a core in charge: the robot, its woken pieces, and copies its bays let go. */
  robots: number;
}

export interface SideReport extends SideCount {
  name: string;
  team: number;
  at: { x: number; y: number };
  startCores: number;
  startParts: number;
  /** When it lost, seconds, and how: its main core was destroyed, or left the bounds (at `lostWhere`). Absent while it is in the match. */
  lostAt?: number;
  lostBy?: 'core' | 'bounds';
  lostWhere?: { x: number; y: number };
  /** Starting parts that ended themselves: destroyed with a blast of their own, or burnt out. Left out of `share`. */
  spent: number;
  /** Copies its fabricator bays let go. */
  copies: number;
}

/** A script that stopped (a crash, or a tick over its budget): it stays stopped for the rest of the match. */
export interface ScriptStop {
  side: Side;
  /** The robot it ran on, and whether that robot held the side's main core (else a piece or a copy). */
  robot: number;
  main: boolean;
  /** The core in charge of that robot. */
  core?: string;
  script: string;
  t: number;
  kind: string;
  message: string;
}

export interface DuelReport {
  world: string;
  a: SideReport;
  b: SideReport;
  seed: number;
  /** The longest the match could run, and how long it ran. */
  seconds: number;
  length: number;
  ticks: number;
  winner: Side | 'draw';
  why: string;
  samples: { tick: number; t: number; a: SideCount; b: SideCount }[];
  bounds: Bounds | false;
  /** Scripts that stopped, with whose they were. */
  scriptCrashes: ScriptStop[];
  /** Wall-clock milliseconds per tick on this machine, as `bench` measures them. */
  timing: { avgMs: number; p95Ms: number; worstMs: number; scriptMs: number; restMs: number; callsPerTick: number };
  finalHash: string;
}

/** A spot the world will not take a robot at. */
export class SpawnRefused extends Error {}

/**
 * One side's starting robot, followed through the match. A piece that breaks off (a split, a decoupler, a bay letting
 * go) is a new robot built from the same part objects (`rebuildRobot`), so a starting part is alive while some robot
 * in the world still holds that object, and the main core (the robot's primary core at spawn) is the same object
 * wherever it now is. Parts a bay builds later are new objects and are never counted. A robot destroyed whole logs
 * `removed` and never `coreLost`, so the main core is looked for among the world's robots, not in that event.
 */
export class SideWatch {
  readonly team: number;
  readonly startParts: number;
  readonly startCores: number;
  private readonly parts: Set<PartInstance>;
  private readonly cores: Set<PartInstance>;
  private readonly ids: Set<string>;
  private readonly main: PartInstance | undefined;
  /** The robot that holds the main core now. */
  private holder: Robot | undefined;
  lostTick: number | undefined;
  lostBy: 'core' | 'bounds' | undefined;
  lostWhere: { x: number; y: number } | undefined;
  spent = 0;
  copies = 0;

  constructor(robot: Robot) {
    this.team = robot.team;
    this.parts = new Set(robot.parts.values());
    this.cores = new Set([...robot.parts.values()].filter((p) => p.def.role === 'core'));
    this.ids = new Set(robot.parts.keys());
    this.main = robot.parts.get(robot.primaryCoreId ?? '');
    this.holder = robot;
    this.startParts = this.parts.size;
    this.startCores = this.cores.size;
  }

  /** The main core, looked for where it last was (a split leaves it in its robot), then in every robot. */
  private findMain(world: World): boolean {
    const main = this.main;
    if (!main || main.health <= 0) return false;
    const h = this.holder;
    if (h && world.robotById(h.id) === h && h.parts.get(main.id) === main) return true;
    this.holder = world.robots.find((r) => r.parts.get(main.id) === main);
    return this.holder !== undefined;
  }

  /** Every tick, a few lookups however big the robots are: the main core destroyed, or out of bounds, has lost. */
  check(world: World, bounds: Bounds | false): void {
    if (this.lostTick !== undefined) return;
    if (!this.findMain(world) || !this.holder || !this.main) {
      this.lostTick = world.tick;
      this.lostBy = 'core';
      return;
    }
    if (bounds === false) return;
    const p = partWorldPose(world, this.holder, this.main.id);
    if (Math.abs(p.x) <= bounds.x && p.y <= bounds.y) return;
    this.lostTick = world.tick;
    this.lostBy = 'bounds';
    this.lostWhere = { x: p.x, y: p.y };
  }

  /** A part of one of this team's robots ended itself (it blasted, or burnt out): if it was a starting part, it is spent. */
  ended(partId: string): void {
    // A bay's copy never has a starting part's id (ids already in the blueprint are kept for good), so the id is enough.
    if (this.ids.has(partId)) this.spent++;
  }

  /** Walks every robot's parts (so only for a row of the report): a part counts while a live robot holds it. */
  count(world: World): SideCount {
    let parts = 0;
    let cores = 0;
    let robots = 0;
    for (const robot of world.robots) {
      if (robot.team === this.team && world.canControl(robot.id)) robots++;
      for (const p of robot.parts.values()) {
        if (p.health <= 0 || !this.parts.has(p)) continue;
        parts++;
        if (this.cores.has(p)) cores++;
      }
    }
    const of = this.startParts - this.spent;
    return { cores, parts, share: of > 0 ? parts / of : 0, robots };
  }

  holds(robot: number): boolean {
    return this.holder?.id === robot;
  }

  get lost(): boolean {
    return this.lostTick !== undefined;
  }
}

/** Top level scripts all on (as `bench` turns them on): nobody presses the key that would start one. */
function scriptsOn(raw: unknown): unknown {
  const bp = structuredClone(raw) as { scripts?: { enabled?: boolean }[] } | null;
  if (bp && typeof bp === 'object' && Array.isArray(bp.scripts)) for (const s of bp.scripts) s.enabled = true;
  return bp;
}

/** The core height at which the blueprint's lowest part sits on the ground (y 0), measured as `World.canPlace` does. */
function restingY(world: World, raw: unknown): number {
  const bp = validateBlueprint(raw, world.registry).blueprint;
  const root = bp?.parts.find((p) => p.id === rootPartId(bp, world.registry));
  if (!bp || !root) return 0;
  let lowest = Infinity;
  for (const p of bp.parts) {
    const collider = world.registry.get(p.part).collider;
    const half = collider?.shape === 'ball' ? (collider.radius ?? 0.5) : 0.5;
    for (const { cell } of partCells(p, world.registry)) lowest = Math.min(lowest, cell.y - root.y - half);
  }
  return -lowest;
}

/** Where the entry's main core goes: its own height, or the lowest the world takes it at from resting on the ground up. */
function spawnSpot(world: World, entry: DuelEntry, raw: unknown, x: number): { x: number; y: number } {
  if (entry.y !== undefined) {
    if (entry.y > MAX_SPAWN_Y) throw new SpawnRefused(`${entry.name} cannot spawn with its core at height ${entry.y}: the highest allowed is ${MAX_SPAWN_Y} m`);
    const at = { x, y: entry.y };
    const can = world.canPlace(raw, at);
    if (!can.ok) throw new SpawnRefused(`${entry.name} cannot spawn with its core at (${x}, ${entry.y}): ${can.reason ?? 'the world refused the spot'}`);
    return at;
  }
  const rest = restingY(world, raw);
  let reason = '';
  // The placing check wants a little air under a part, so try a few heights from touching the ground up.
  for (let lift = 0; lift <= 1; lift += 0.05) {
    const at = { x, y: Math.round((rest + lift) * 100) / 100 };
    const can = world.canPlace(raw, at);
    if (can.ok) return at;
    reason = can.reason ?? 'the world refused the spot';
  }
  throw new SpawnRefused(`${entry.name} cannot spawn on the ground with its core at x ${x} (height ${rest.toFixed(2)}): ${reason}`);
}

const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

/**
 * A match between two robots that run themselves (the titans tournament, docs/plans/titans-tournament.md): a on the
 * left on team 0, b on the right on team 1 and flipped, in the arena unless another world is given. A side has lost
 * when its main core is destroyed or leaves the bounds; with both still in at the end it is a draw.
 */
export async function duel(a: DuelEntry, b: DuelEntry, opts: DuelOptions): Promise<DuelReport> {
  const file = opts.file ?? parseWorldFile(readJson(ARENA_WORLD));
  const { host, clock } = timedHost(opts.world?.scripts ?? (await scriptHost()));
  const world = await World.create({ seed: opts.seed, ...opts.world, scripts: host }, file);
  try {
    const x = opts.x ?? DUEL_X;
    const entries: { entry: DuelEntry; raw: unknown; x: number; team: number }[] = [
      { entry: a, raw: scriptsOn(a.raw), x: -x, team: 0 },
      { entry: b, raw: orientRaw(scriptsOn(b.raw), { flip: true }, world.registry), x, team: 1 },
    ];
    const bounds = opts.bounds ?? DEFAULT_BOUNDS;
    const watches: SideWatch[] = [];
    const spots: { x: number; y: number }[] = [];
    const teamOf = new Map<number, number>();
    for (const e of entries) {
      const v = validateBlueprint(e.raw, world.registry);
      if (!v.ok) throw new InvalidBlueprint(v.issues);
      const at = spawnSpot(world, e.entry, e.raw, e.x);
      const robot = world.spawnBlueprint(e.raw, at, { team: e.team });
      if (robot.primaryCoreId === undefined) throw new SpawnRefused(`${e.entry.name} has no core, so nothing runs it`);
      spots.push(at);
      teamOf.set(robot.id, robot.team);
      watches.push(new SideWatch(robot));
    }
    const [wa, wb] = watches as [SideWatch, SideWatch];
    const watchOf = (robot: number): SideWatch | undefined => watches[teamOf.get(robot) ?? -1];

    const ticks = Math.max(1, Math.round(opts.seconds / world.dt));
    const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 10) / world.dt));
    const grace = Math.round(GRACE_SECONDS / world.dt);
    const samples: DuelReport['samples'] = [];
    const crashes: ScriptStop[] = [];
    const times: number[] = [];
    let seenEvents = world.events.length;
    let stopAt = ticks;
    clock.take();
    while (world.tick < stopAt) {
      const t0 = performance.now();
      world.step();
      times.push(performance.now() - t0);
      for (; seenEvents < world.events.length; seenEvents++) {
        const e = world.events[seenEvents];
        if (!e) continue;
        // Every robot but the two that spawned is a piece of one of them, and is on its team.
        if (e.kind === 'split') for (const id of e.pieces) teamOf.set(id, teamOf.get(e.robot) ?? -1);
        const w = watchOf(e.robot);
        if (!w) continue;
        if (e.kind === 'released') w.copies++;
        if (e.kind === 'partDestroyed' && (e.exploded || e.burntOut === true)) w.ended(e.part);
        if (e.kind === 'scriptCrashed') {
          const core = world.robotById(e.robot)?.primaryCoreId;
          crashes.push({ side: w === wa ? 'a' : 'b', robot: e.robot, main: w.holds(e.robot), ...(core !== undefined ? { core } : {}), script: e.script, t: e.tick * world.dt, kind: e.error.kind, message: e.error.message });
        }
      }
      const before = wa.lost || wb.lost;
      for (const w of watches) w.check(world, bounds);
      if (!before && (wa.lost || wb.lost)) stopAt = Math.min(ticks, world.tick + grace);
      if (world.tick % every === 0 || world.tick === stopAt) samples.push({ tick: world.tick, t: world.tick * world.dt, a: wa.count(world), b: wb.count(world) });
    }

    const side = (w: SideWatch, entry: DuelEntry, at: { x: number; y: number }): SideReport => ({
      name: entry.name,
      team: w.team,
      at,
      startCores: w.startCores,
      startParts: w.startParts,
      ...w.count(world),
      ...(w.lostTick !== undefined && w.lostBy !== undefined ? { lostAt: w.lostTick * world.dt, lostBy: w.lostBy } : {}),
      ...(w.lostWhere ? { lostWhere: w.lostWhere } : {}),
      spent: w.spent,
      copies: w.copies,
    });
    const ra = side(wa, a, spots[0] as { x: number; y: number });
    const rb = side(wb, b, spots[1] as { x: number; y: number });
    const scripts = clock.take();
    const run = times.length;
    const sorted = [...times].sort((p, q) => p - q);
    const avg = times.reduce((p, q) => p + q, 0) / run;
    const scriptMs = scripts.ms / run;
    return {
      world: file.name,
      a: ra,
      b: rb,
      seed: opts.seed,
      seconds: opts.seconds,
      length: world.tick * world.dt,
      ticks: world.tick,
      ...verdict(ra, rb),
      samples,
      bounds,
      scriptCrashes: crashes,
      timing: {
        avgMs: avg,
        p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
        worstMs: sorted[sorted.length - 1] ?? 0,
        scriptMs,
        restMs: avg - scriptMs,
        callsPerTick: scripts.calls / run,
      },
      finalHash: world.hash(),
    };
  } finally {
    world.dispose();
  }
}

/** Who won and why, from the two sides at the end. */
export function verdict(a: SideReport, b: SideReport): Pick<DuelReport, 'winner' | 'why'> {
  const how = (k: Side, s: SideReport): string => {
    const t = `t=${(s.lostAt ?? 0).toFixed(2)} s`;
    return s.lostBy === 'bounds' ? `${k}'s main core went out of bounds at ${t}, at (${(s.lostWhere?.x ?? 0).toFixed(0)}, ${(s.lostWhere?.y ?? 0).toFixed(0)})` : `${k}'s main core was destroyed at ${t}`;
  };
  if (a.lostAt !== undefined && b.lostAt !== undefined) {
    // A match stops GRACE_SECONDS after the first loss, so two losses in one match are always this close.
    if (Math.abs(a.lostAt - b.lostAt) <= GRACE_SECONDS + 1e-9) return { winner: 'draw', why: `both lost within ${GRACE_SECONDS} s: ${how('a', a)}; ${how('b', b)}` };
    return a.lostAt < b.lostAt ? { winner: 'b', why: how('a', a) } : { winner: 'a', why: how('b', b) };
  }
  if (a.lostAt !== undefined) return { winner: 'b', why: how('a', a) };
  if (b.lostAt !== undefined) return { winner: 'a', why: how('b', b) };
  return { winner: 'draw', why: `time ran out with both main cores alive (a has ${pct(a.share)} of its parts left, b ${pct(b.share)})` };
}

/**
 * Stopped scripts as lines, the same stop on many robots (a swarm's pieces) as one line. A stopped script is the
 * usual way a robot fails without a sound, so the report always says, even when there are none.
 */
export function formatStops(stops: readonly ScriptStop[], names: Record<Side, string>): string[] {
  if (stops.length === 0) return ['scripts stopped: none'];
  const groups = new Map<string, ScriptStop[]>();
  for (const c of stops) {
    const key = `${c.side}|${c.main ? 'main' : 'piece'}|${c.script}|${c.kind}|${c.message}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const lines = [`scripts stopped: ${stops.length} (a stopped script stays stopped)`];
  for (const g of groups.values()) {
    const c = g[0] as ScriptStop;
    const t = `t=${c.t.toFixed(2)} s`;
    const where = c.main ? `on the robot with its main core (robot ${c.robot})` : g.length === 1 ? `on a piece or copy (robot ${c.robot}${c.core !== undefined ? `, ${c.core}` : ''})` : `on ${g.length} pieces or copies (first robot ${c.robot}${c.core !== undefined ? `, ${c.core}` : ''})`;
    lines.push(`  ${c.side} ${names[c.side]}: script ${c.script} ${where} at ${g.length > 1 ? `${t} and after` : t} (${c.kind}): ${c.message}`);
  }
  return lines;
}

/** The match as text: a row every 10 s, then who won, each side, stopped scripts, and how long a tick took. */
export function formatDuel(r: DuelReport): string {
  const f = (v: number): string => v.toFixed(2);
  const where = (s: SideReport): string => `core at (${s.at.x}, ${f(s.at.y)})`;
  const lines = [
    `duel: a ${r.a.name} (team 0, ${where(r.a)}) against b ${r.b.name} (team 1, flipped, ${where(r.b)})   world ${r.world}   seed ${r.seed}   up to ${r.seconds} s   bounds ${r.bounds === false ? 'off' : `x ${r.bounds.x}, y ${r.bounds.y}`}`,
    '     t   tick   a: cores   parts  robots   b: cores   parts  robots',
  ];
  const cell = (c: SideCount, start: number): string => `${`${c.cores}/${start}`.padStart(8)} ${pct(c.share).padStart(7)} ${String(c.robots).padStart(7)}`;
  for (const s of r.samples) lines.push(`${f(s.t).padStart(6)} ${String(s.tick).padStart(6)}   ${cell(s.a, r.a.startCores)}   ${cell(s.b, r.b.startCores)}`);
  lines.push(`winner: ${r.winner === 'draw' ? 'draw' : `${r.winner} (${r[r.winner].name})`}`);
  lines.push(`why: ${r.why}`);
  for (const k of ['a', 'b'] as const) {
    const s = r[k];
    const spent = s.spent > 0 ? `, ${s.spent} more ended themselves` : '';
    lines.push(`${k} ${s.name}: ${s.parts} of ${s.startParts} starting parts alive${spent} (${pct(s.share)} left), ${s.cores} of ${s.startCores} starting cores, ${s.robots} robot${s.robots === 1 ? '' : 's'} with a core now, ${s.copies} cop${s.copies === 1 ? 'y' : 'ies'} released`);
  }
  lines.push(...formatStops(r.scriptCrashes, { a: r.a.name, b: r.b.name }));
  lines.push(`length: ${f(r.length)} s (${r.ticks} ticks)${r.length < r.seconds ? `, stopped ${GRACE_SECONDS} s after the first loss` : ''}`);
  const t = r.timing;
  lines.push(`time per tick on this machine: ${f(t.avgMs)} ms average, ${f(t.p95Ms)} ms 95th percentile, ${f(t.worstMs)} ms worst (scripts ${f(t.scriptMs)}, the rest ${f(t.restMs)}, ${t.callsPerTick.toFixed(1)} script calls per tick)`);
  lines.push(`hash: ${r.finalHash}`);
  return lines.join('\n');
}
