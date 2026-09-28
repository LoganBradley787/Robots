import { partWorldPose, sampleRobot, type KeyPress, type Robot, type World, type WorldEvent } from '@robots/sim-core';

/** Where a piece is, or was when last seen. */
export interface PieceState {
  x: number;
  y: number;
  tiltDeg: number;
  speed: number;
  resting: boolean;
  parts: number;
  energy?: { stored: number; capacity: number };
}

/**
 * Every robot the run saw (M7): the spawned one (A), pieces that broke off, and dropped blueprints, each with a
 * letter used in the events and the plot.
 */
export interface PieceReport {
  mark: string;
  /** Robot id in the world. */
  id: number;
  name: string;
  /** The letter of the robot it broke off. */
  from?: string;
  /** Set for a `--drop`: the blueprint name. */
  dropped?: string;
  /** Its active core with the core's scope (`core@8,6 (missile1)`), `2 dormant cores`, or `no core`. */
  core: string;
  appearedAt: number;
  goneAt?: number;
  /** At the end of the run, or where it was last seen when it is gone. */
  final: PieceState;
  /** The core's (else the root part's) position every `trackEvery` seconds, plus its first and last. */
  track: { t: number; x: number; y: number }[];
  /** Where each of its parts is at the end (empty when it is gone), so the side view shows its shape. */
  finalParts: { x: number; y: number }[];
  /** M8: its team (0 yours, 1 enemy). */
  team: number;
  /** M8: the points its scripts marked the last time they marked any. */
  marks: { x: number; y: number; label?: string }[];
}

export interface TraceEvent {
  t: number;
  /** The letter of the robot it happened to. */
  robot: string;
  kind: string;
  text: string;
  /** Log lines only: how many more times the same line came right after, and when the last one did. */
  repeats?: number;
  until?: number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A, B, ..., Z, then AA, AB, ... so every piece keeps its own name however many a blast makes. */
function markFor(n: number): string {
  return n < 26 ? (LETTERS[n] ?? '?') : `${LETTERS[Math.floor(n / 26) - 1] ?? '?'}${LETTERS[n % 26] ?? '?'}`;
}
const f2 = (v: number): string => v.toFixed(2);

/**
 * Watches a headless run tick by tick and keeps what Claude needs to see what happened: each robot's path, the
 * world's events and script logs in order with the robot's letter, and each piece's final state.
 */
export class Tracer {
  private readonly pieces = new Map<number, PieceReport>();
  private readonly events: TraceEvent[] = [];
  private readonly blasts: { x: number; y: number }[] = [];
  /** Shell hits being folded (M13), by hit robot and shooter. */
  private readonly hits = new Map<string, { ev: TraceEvent; by: string; count: number; damage: number; parts: Map<string, number>; first: number; last: number }>();
  private readonly lastLog = new Map<string, TraceEvent>();
  /** Each robot's scripts that were on after the last step, to report a key turning one on or off. */
  private readonly scriptsOn = new Map<number, Set<string>>();
  private seenEvents = 0;
  /** M8: what each robot's sensors see, and for how many ticks each contact has been out of sight. */
  private readonly sight = new Map<number, Map<number, number>>();
  private stepStart = 0;
  private readonly world: World;
  private readonly trackEvery: number;

  /** `trackEvery`: ticks between path points. */
  constructor(world: World, main: Robot, keys: readonly KeyPress[], trackEvery: number) {
    this.world = world;
    this.trackEvery = trackEvery;
    this.add(main);
    this.scriptsOn.set(main.id, new Set(world.scripts(main.id).filter((sc) => sc.enabled).map((sc) => sc.id)));
    for (const k of keys) {
      const tap = Math.round(k.up / world.dt) <= Math.round(k.down / world.dt);
      this.events.push({ t: k.down, robot: 'A', kind: 'key', text: tap ? `key ${k.key} tapped` : `key ${k.key} held until t=${f2(k.up)}` });
    }
  }

  /** A `--drop` spawned just now. */
  dropped(robot: Robot, name: string): void {
    const p = this.add(robot);
    p.dropped = name;
    this.events.push({ t: this.world.time, robot: p.mark, kind: 'drop', text: `${name} dropped at (${f2(robot.spawnX)}, ${f2(robot.spawnY)})` });
  }

  beforeStep(): void {
    this.stepStart = this.world.tick;
  }

  afterStep(): void {
    const w = this.world;
    const tickTime = this.stepStart * w.dt;
    const newEvents = w.events.slice(this.seenEvents);
    this.seenEvents = w.events.length;
    for (const e of newEvents) {
      if (e.kind === 'split') for (const id of e.pieces) this.letter(id, e.robot);
      if (e.kind === 'coreWoke') this.letter(e.robot, e.from);
    }
    for (const r of w.robots) if (!this.pieces.has(r.id)) this.add(r);

    // Parts destroyed in one go (a blast) make one event per robot.
    let destroyed: { ev: TraceEvent; parts: string[] } | undefined;
    const push = (robot: number, kind: string, text: string): void => {
      this.events.push({ t: tickTime, robot: this.letter(robot), kind, text });
    };
    // The world reports a piece waking before the split that made it: tell the split first.
    const woke = newEvents.filter((e) => e.kind === 'coreWoke');
    const ordered = newEvents.filter((e) => e.kind !== 'coreWoke').flatMap((e): WorldEvent[] => (e.kind === 'split' ? [e, ...woke.filter((x) => e.pieces.includes(x.robot))] : [e]));
    for (const x of woke) if (!ordered.includes(x)) ordered.push(x);
    for (const e of ordered) {
      if (e.kind !== 'partDestroyed') destroyed = undefined;
      switch (e.kind) {
        case 'partDestroyed': {
          // A flare burning out is told by its burntOut event (M11), not as a part lost.
          if (e.burntOut === true) break;
          const mark = this.letter(e.robot);
          if (!destroyed || destroyed.ev.robot !== mark) {
            destroyed = { ev: { t: tickTime, robot: mark, kind: 'destroyed', text: '' }, parts: [] };
            this.events.push(destroyed.ev);
          }
          destroyed.parts.push(e.part);
          destroyed.ev.text = `lost ${destroyed.parts.length} part${destroyed.parts.length === 1 ? '' : 's'}: ${destroyed.parts.join(', ')}`;
          break;
        }
        case 'explosion':
          this.blasts.push({ x: e.x, y: e.y });
          push(e.robot, 'explosion', `explosion at (${f2(e.x)}, ${f2(e.y)}), radius ${e.radius} m`);
          break;
        case 'split':
          push(e.robot, 'split', `split: ${e.pieces.map((id) => this.letter(id)).join(', ')} broke off`);
          break;
        case 'decoupled': {
          // The robot's tilt when it lets go: a missile leaves along the robot's aim, tilt included.
          const r = w.robots.find((x) => x.id === e.robot);
          const pose = r ? poseAngle(w, r) : undefined;
          push(e.robot, 'decoupled', `${e.part} fired${pose !== undefined ? ` (robot tilted ${pose.toFixed(1)} deg)` : ''}`);
          break;
        }
        case 'coreWoke': {
          const keys = w.controller(e.robot)?.keys ?? [];
          const scripts = w.scripts(e.robot).map((s) => s.id + (s.enabled ? '' : ' (off)'));
          const robot = w.robots.find((r) => r.id === e.robot);
          const waiting = robot?.parts.get(robot.primaryCoreId ?? '')?.inbox?.length ?? 0;
          const inbox = waiting > 0 ? `; ${waiting} message${waiting === 1 ? '' : 's'} waiting in its inbox` : '';
          push(e.robot, 'woke', `woke: ${robot ? coreLabel(robot) : 'its core'} runs its own controls; keys ${keys.join(', ') || 'none'}; scripts ${scripts.join(', ') || 'none'}${inbox}`);
          break;
        }
        case 'armed':
          push(e.robot, 'armed', `${e.part} armed`);
          break;
        case 'lit':
          push(e.robot, 'lit', `${e.part} lit: while it burns, sensors that see it take it for ${this.letter(e.of)}`);
          break;
        case 'burntOut':
          push(e.robot, 'burntOut', `${e.part} burnt out`);
          break;
        case 'built':
          push(e.robot, 'built', `${e.part} built ${e.recipe} (${e.scope}), holding it`);
          break;
        case 'released':
          push(e.robot, 'released', `${e.part} let go of ${e.scope}`);
          break;
        case 'buildBlocked':
          push(e.robot, 'buildBlocked', `${e.part} cannot build: ${e.why}`);
          break;
        case 'coreLost':
          push(e.robot, 'coreLost', 'lost its core: nobody controls it now, its inputs stay as they were');
          break;
        case 'removed':
          push(e.robot, 'removed', 'is gone');
          break;
        case 'energyEmpty':
          push(e.robot, 'energyEmpty', 'ran out of energy');
          break;
        case 'scriptCrashed':
          push(e.robot, 'scriptCrashed', `script ${e.script} stopped (${e.error.kind}): ${e.error.message}`);
          break;
        case 'shellHit': {
          // Shells come ten a second per gun (M13): hits on one piece by one shooter within a second fold into one line.
          const key = `${e.robot}:${e.by}`;
          const run = this.hits.get(key);
          if (run && tickTime - run.last <= 1) {
            run.count++;
            run.damage += e.damage;
            run.parts.set(e.part, (run.parts.get(e.part) ?? 0) + 1);
            run.last = tickTime;
          } else {
            const ev: TraceEvent = { t: tickTime, robot: this.letter(e.robot), kind: 'shellHit', text: '' };
            this.events.push(ev);
            this.hits.set(key, { ev, by: this.letter(e.by), count: 1, damage: e.damage, parts: new Map([[e.part, 1]]), first: tickTime, last: tickTime });
          }
          const r = this.hits.get(key);
          if (r) {
            const parts = [...r.parts].map(([id, n]) => (n > 1 ? `${id} x${n}` : id)).join(', ');
            const until = r.last > r.first ? ` until t=${r.last.toFixed(2)}` : '';
            r.ev.text = `hit by ${r.count} shell${r.count === 1 ? '' : 's'} from ${r.by}${until}: ${r.damage} damage (${parts})`;
          }
          break;
        }
        case 'sent': {
          const r = w.robots.find((x) => x.id === e.robot);
          const scope = r?.blueprint.cores?.find((c) => c.core === e.to)?.scope;
          push(e.robot, 'sent', `sent ${e.to}${scope !== undefined ? ` (${scope})` : ''}: ${e.data.length > 120 ? `${e.data.slice(0, 117)}...` : e.data}`);
          break;
        }
      }
    }

    // Script logs from this step (the world keeps only the latest few hundred, so read them every step).
    const logs = [];
    for (let i = w.scriptLogs.length - 1; i >= 0; i--) {
      const l = w.scriptLogs[i];
      if (!l || l.tick < this.stepStart) break;
      logs.unshift(l);
    }
    for (const l of logs) {
      const mark = this.letter(l.robot);
      const key = `${l.robot} ${l.script}`;
      const text = `${l.script}: ${l.text}`;
      const prev = this.lastLog.get(key);
      if (prev && prev.text === text) {
        prev.repeats = (prev.repeats ?? 0) + 1;
        prev.until = l.tick * w.dt;
        continue;
      }
      const ev: TraceEvent = { t: l.tick * w.dt, robot: mark, kind: 'log', text };
      this.lastLog.set(key, ev);
      this.events.push(ev);
    }

    for (const r of w.robots) {
      const on = new Set(w.scripts(r.id).filter((sc) => sc.enabled && sc.crashed === undefined).map((sc) => sc.id));
      const before = this.scriptsOn.get(r.id);
      this.scriptsOn.set(r.id, on);
      if (!before) continue;
      const mark = this.letter(r.id);
      for (const sc of w.scripts(r.id)) {
        if (sc.crashed !== undefined) continue;
        if (on.has(sc.id) && !before.has(sc.id)) this.events.push({ t: tickTime, robot: mark, kind: 'scriptOn', text: `script ${sc.id} turned on` });
        if (!on.has(sc.id) && before.has(sc.id)) this.events.push({ t: tickTime, robot: mark, kind: 'scriptOff', text: `script ${sc.id} turned off` });
      }
    }

    this.traceSight(tickTime);

    const alive = new Set(w.robots.map((r) => r.id));
    for (const r of w.robots) {
      const p = this.pieces.get(r.id);
      if (!p) continue;
      const marks = w.marks(r.id);
      if (marks.length > 0) p.marks = marks.map((m) => ({ ...m }));
      const pose = poseOf(w, r);
      if (!pose) continue;
      p.final = { ...p.final, x: pose.x, y: pose.y };
      if ((w.tick - Math.round(p.appearedAt / w.dt)) % this.trackEvery === 0) p.track.push({ t: w.time, x: pose.x, y: pose.y });
    }
    for (const p of this.pieces.values()) {
      if (p.goneAt !== undefined || alive.has(p.id)) continue;
      p.goneAt = tickTime;
      addPoint(p, { t: tickTime, x: p.final.x, y: p.final.y });
    }
  }

  /**
   * M8: "A sees B (enemy)" when a robot's sensors first see another, and "A lost sight of B" once it has been out of
   * sight for a quarter second (a contact at the edge of a cone would otherwise flicker).
   */
  private traceSight(tickTime: number): void {
    const w = this.world;
    const lostAfter = Math.max(1, Math.round(0.25 / w.dt));
    for (const r of w.robots) {
      const view = w.sensorView(r.id);
      const known = this.sight.get(r.id) ?? new Map<number, number>();
      if (view.sensors.length === 0 && known.size === 0) continue;
      this.sight.set(r.id, known);
      const now = new Map(view.contacts.map((c) => [c.id, c.side]));
      for (const [id, side] of now) {
        if (!known.has(id)) this.events.push({ t: tickTime, robot: this.letter(r.id), kind: 'sees', text: `sees ${this.letter(id)} (${side})` });
        known.set(id, 0);
      }
      for (const [id, unseen] of known) {
        if (now.has(id)) continue;
        if (unseen + 1 >= lostAfter) {
          known.delete(id);
          this.events.push({ t: tickTime, robot: this.letter(r.id), kind: 'lostSight', text: `lost sight of ${this.letter(id)}` });
        } else known.set(id, unseen + 1);
      }
    }
  }

  /** Final states, and events in time order (keys and drops before what they caused in the same tick). */
  finish(): { pieces: PieceReport[]; events: TraceEvent[]; blasts: { x: number; y: number }[] } {
    const w = this.world;
    for (const r of w.robots) {
      const p = this.pieces.get(r.id);
      if (!p) continue;
      const s = sampleRobot(w, r);
      const e = w.energy(r.id);
      p.core = coreLabel(r);
      p.final = { x: s.coreX, y: s.coreY, tiltDeg: s.tiltDeg, speed: s.speed, resting: s.resting, parts: s.parts, ...(e && e.capacity > 0 ? { energy: { stored: e.stored, capacity: e.capacity } } : {}) };
      addPoint(p, { t: w.time, x: s.coreX, y: s.coreY });
      p.finalParts = [...r.parts.keys()].map((id) => partWorldPose(w, r, id)).map((q) => ({ x: q.x, y: q.y }));
    }
    const order = (k: string): number => (k === 'key' || k === 'drop' ? 0 : 1);
    const events = this.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || order(a.e.kind) - order(b.e.kind) || a.i - b.i).map((x) => x.e);
    return { pieces: [...this.pieces.values()], events, blasts: this.blasts };
  }

  private add(r: Robot): PieceReport {
    const known = this.pieces.get(r.id);
    if (known) return known;
    const mark = markFor(this.pieces.size);
    const pose = poseOf(this.world, r) ?? { x: r.spawnX, y: r.spawnY };
    const p: PieceReport = {
      mark,
      id: r.id,
      name: r.name,
      core: coreLabel(r),
      appearedAt: this.world.tick * this.world.dt,
      final: { x: pose.x, y: pose.y, tiltDeg: 0, speed: 0, resting: false, parts: r.parts.size },
      track: [{ t: this.world.time, x: pose.x, y: pose.y }],
      finalParts: [],
      team: r.team,
      marks: [],
    };
    if (r.brokeFrom !== undefined) {
      const from = this.pieces.get(r.brokeFrom);
      if (from) p.from = from.mark;
    }
    this.pieces.set(r.id, p);
    return p;
  }

  /**
   * A piece the run never saw alive: it broke off and was destroyed in the same step. It still gets a letter and an
   * entry, placed where its parent was, and is marked gone after this step.
   */
  private addGone(id: number, from?: number): PieceReport {
    const parent = from === undefined ? undefined : this.pieces.get(from);
    const at = parent?.final ?? { x: 0, y: 0 };
    const p: PieceReport = {
      mark: markFor(this.pieces.size),
      id,
      name: parent?.name ?? `robot ${id}`,
      core: 'no core',
      appearedAt: this.stepStart * this.world.dt,
      final: { x: at.x, y: at.y, tiltDeg: 0, speed: 0, resting: false, parts: 0 },
      track: [],
      finalParts: [],
      team: parent?.team ?? 0,
      marks: [],
      ...(parent ? { from: parent.mark } : {}),
    };
    this.pieces.set(id, p);
    return p;
  }

  /** The robot's letter, giving one to a new piece (of `from`) first. */
  private letter(id: number, from?: number): string {
    const known = this.pieces.get(id);
    if (known) return known.mark;
    const r = this.world.robots.find((x) => x.id === id);
    if (!r) return this.addGone(id, from).mark;
    const p = this.add(r);
    if (p.from === undefined && from !== undefined) {
      const parent = this.pieces.get(from);
      if (parent) p.from = parent.mark;
    }
    return p.mark;
  }
}

function addPoint(p: PieceReport, pt: { t: number; x: number; y: number }): void {
  const last = p.track.at(-1);
  if (!last || last.t !== pt.t) p.track.push(pt);
}

/** The robot's core (else root) angle in degrees, counterclockwise positive, in (-180, 180]. */
function poseAngle(world: World, r: Robot): number | undefined {
  const id = r.primaryCoreId ?? (r.parts.has(r.rootId) ? r.rootId : undefined);
  if (id === undefined) return undefined;
  let d = (partWorldPose(world, r, id).angle * 180) / Math.PI;
  d %= 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d + 0;
}

function poseOf(world: World, r: Robot): { x: number; y: number } | undefined {
  const id = r.primaryCoreId ?? (r.parts.has(r.rootId) ? r.rootId : r.parts.keys().next().value);
  if (id === undefined) return undefined;
  try {
    return partWorldPose(world, r, id);
  } catch {
    return undefined;
  }
}

/** `core@1,1`, `core@8,6 (missile1)` for a woken core with a scope, `2 dormant cores`, or `no core`. */
export function coreLabel(r: Robot): string {
  if (r.primaryCoreId !== undefined) {
    const scope = r.woke ? r.blueprint.cores?.find((c) => c.core === r.primaryCoreId)?.scope : undefined;
    return `${r.primaryCoreId}${scope !== undefined ? ` (${scope})` : ''}`;
  }
  const cores = [...r.parts.values()].filter((p) => p.def.role === 'core').length;
  return cores === 0 ? 'no core' : `${cores} dormant core${cores === 1 ? '' : 's'}`;
}
