import type { Shell, World, WorldEvent } from '@robots/sim-core';
import { PIXELS_PER_METER } from '../render/units';
import type { SettingsStore } from '../world/deploySettings';
import { AudioEngine } from './AudioEngine';
import { OneShotLimiter } from './limiter';
import { hear, type Ear } from './listener';
import { LoopBank } from './loops';
import { ONE_SHOTS, explosionFor, material } from './oneShots';
import { ShotWatcher } from './ShotWatcher';
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from './soundSettings';

/** A one-shot waiting for this frame's ear: where it is and how loud it is on its own. */
interface Pending {
  name: string;
  x: number;
  y: number;
  gain: number;
  rate: number;
  must?: boolean;
}

/** A one-shot an event asks for: its name, how loud it is on its own, its playback rate. */
export interface EventSound {
  name: string;
  gain: number;
  rate: number;
  must?: true;
}

/** What the sounds of an event need to know about a part type, from its def. */
export interface PartSounds {
  /** What it sounds like struck (`metal`, `armor`, `soft`). */
  material(partType: string): string;
  /** Its firing sound's name (the def's `sound.fire`), if it has one. */
  fire(partType: string): string | undefined;
  /** How hard it backfires, 0 to 1 (a cannon against a lance). */
  backfire(partType: string): number;
}

/** The one-shots a world event makes. */
export function soundsFor(ev: WorldEvent, parts: PartSounds): EventSound[] {
  const materialOf = parts.material;
  switch (ev.kind) {
    case 'explosion':
      return [{ name: explosionFor(ev.radius), gain: Math.min(1.5, 0.6 + ev.radius / 6), rate: 1, must: true }];
    case 'partDestroyed':
      // A part that explodes gets the blast, a burnt-out flare just goes out (as the effects do).
      return ev.exploded || ev.burntOut === true ? [] : [{ name: `break.${materialOf(ev.partType)}`, gain: 0.7, rate: 1 }];
    case 'shellHit':
      return [{ name: `hit.${materialOf(ev.partType)}`, gain: 0.6, rate: 1 }];
    case 'cannonFire': {
      // A charged gun's shot is rare and big: it always plays, as a blast does.
      const fire = parts.fire(ev.partType);
      return fire !== undefined && `fire.${fire}` in ONE_SHOTS ? [{ name: `fire.${fire}`, gain: 1.3, rate: 1, must: true }] : [];
    }
    case 'cannonBackfire':
      return [{ name: 'backfire', gain: 0.6 + 0.6 * parts.backfire(ev.partType), rate: 1.25 - 0.4 * parts.backfire(ev.partType) }];
    case 'boltHit': {
      // A bolt gives each part on its path what it has left: the more it took, the harder and lower the slam.
      const hard = Math.min(1, ev.damage / 250);
      return [{ name: 'hit.bolt', gain: 0.5 + 0.8 * hard, rate: 1.25 - 0.35 * hard }];
    }
    case 'decoupled':
      return [{ name: 'decouple', gain: 0.6, rate: 1 }];
    case 'impact': {
      // Louder the harder it hit and the heavier it is; lower the heavier it is.
      const hard = Math.min(1, (ev.dv - 2) / 14);
      const weight = Math.min(1.6, Math.max(0.25, Math.sqrt(ev.mass) / 5));
      const gain = (0.25 + 0.75 * hard) * weight;
      const thud = { name: 'thud', gain, rate: Math.min(1.4, Math.max(0.55, 1.5 - 0.35 * Math.log10(1 + ev.mass))) };
      return ev.dv > 8 ? [thud, { name: 'rattle', gain: gain * 0.5, rate: 1 }] : [thud];
    }
    default:
      return [];
  }
}

/** Events older than this many ticks are not played (a frame hitch, a tab coming back). */
const STALE_TICKS = 30;

/**
 * The world's sound (M15): the one object the world screen talks to. It turns world events and what the parts are
 * doing into one-shots and loops, as heard from the camera. It only reads the sim. The audio context is made on the
 * first click or key press; until then everything here is a no-op.
 */
export class SoundScene {
  private engine: AudioEngine | undefined;
  private readonly limiter = new OneShotLimiter();
  private shots = new ShotWatcher<Shell>();
  private readonly loops = new LoopBank();
  private pending: Pending[] = [];
  private current: SoundSettings;
  private readonly store: SettingsStore | undefined;
  private timeScale = 1;
  /** What each part type sounds like struck. */
  private readonly materials = new Map<string, string>();
  /** Shots each robot had fired at the last frame, to hear the ones whose shell came and went within a frame. */
  private fired = new Map<number, number>();
  private readonly warned = new Set<string>();
  /** How many of each one-shot have played, for the debug overlay. */
  private readonly played = new Map<string, number>();
  private readonly unlock = (): void => this.wake();
  private readonly onVisibility = (): void => {
    if (document.hidden) void this.engine?.ctx.suspend();
    else void this.engine?.ctx.resume();
  };
  /** Called when the audio context comes up, so the toolbar can stop showing it as waiting. */
  onChange?: () => void;

  constructor(store: SettingsStore | undefined) {
    this.store = store;
    this.current = loadSoundSettings(store);
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get settings(): SoundSettings {
    return this.current;
  }

  /** False until a click or key press has let the browser start audio. */
  get awake(): boolean {
    return this.engine?.ctx.state === 'running';
  }

  /** The engine once it is up, for the soundboard and the load check. */
  get audio(): AudioEngine | undefined {
    return this.engine;
  }

  /** One line for the debug overlay: what is sounding, the output's peak, and what has played since the world began. */
  debugLine(): string {
    if (!this.engine) return 'sound: waiting for a first click or key press';
    const played = [...this.played].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(', ');
    return `sound: ${this.loops.sounding} loops, ${this.limiter.liveAt(this.engine.now)} one-shots, peak ${this.engine.peak().toFixed(2)}${this.current.muted ? ', muted' : ''}   played: ${played || 'nothing yet'}`;
  }

  set(next: Partial<SoundSettings>): void {
    this.current = { ...this.current, ...next };
    saveSoundSettings(this.store, this.current);
    this.engine?.setVolume(this.current.volume, this.current.muted);
  }

  /** Paused is silent. Called from the frame, and when the world is paused from outside it (the builder). */
  setPaused(paused: boolean): void {
    this.engine?.setPaused(paused);
  }

  /** A world event, as the world screen walks them. Queued for this frame's ear. */
  event(ev: WorldEvent, world: World): void {
    if (!this.engine?.ready || this.current.muted || world.tick - ev.tick > STALE_TICKS) return;
    const at = ev as { x?: number; y?: number };
    const def = (type: string) => (world.registry.has(type) ? world.registry.get(type) : undefined);
    const parts: PartSounds = {
      material: (type) => this.materialOf(world, type),
      fire: (type) => def(type)?.sound?.fire,
      // Against the cannon's 80 N s: a lance (30) chokes smaller.
      backfire: (type) => Math.min(1, (def(type)?.cannon?.backfire ?? 0) / 80),
    };
    for (const snd of soundsFor(ev, parts)) this.ask(snd.name, at.x ?? 0, at.y ?? 0, snd.gain, snd.rate, snd.must === true);
  }

  /** Once per drawn frame: moves the ear to the camera, plays what was queued, and updates the loops. */
  frame(world: World, cam: { x: number; y: number; zoom: number }, screenWidth: number, time: { paused: boolean; timeScale: number }): void {
    // Shots are counted even with no audio yet, so waking up mid-fight does not play every shell in flight.
    const shells = this.shots.fresh(world.liveShells());
    for (const s of this.shots.fresh(world.spentShells())) shells.push(s);
    // A shell fired and stopped between two frames (several ticks a frame, a target a few meters off) is in neither
    // list: the robot's shot count says how many, and they are heard from its middle.
    const unseen: { x: number; y: number }[] = [];
    const seen = new Map<number, number>();
    for (const s of shells) seen.set(s.robot, (seen.get(s.robot) ?? 0) + 1);
    const before = this.fired;
    this.fired = new Map();
    for (const robot of world.robots) {
      const total = world.shotsBy(robot.id);
      const missed = total - (before.get(robot.id) ?? 0) - (seen.get(robot.id) ?? 0);
      if (total > 0) this.fired.set(robot.id, total);
      const root = robot.groups[0];
      if (missed <= 0 || !root) continue;
      const at = world.physics.state(root.bodyId);
      for (let i = 0; i < Math.min(missed, 4); i++) unseen.push({ x: at.x, y: at.y });
    }
    const engine = this.engine;
    if (!engine) return;
    engine.setPaused(time.paused);
    this.timeScale = time.timeScale;
    const ear: Ear = { x: cam.x, y: cam.y, zoom: cam.zoom, halfWidth: screenWidth / 2 / (cam.zoom * PIXELS_PER_METER) };
    if (this.current.muted || !engine.ready) {
      this.pending = [];
      this.loops.fade(engine);
      return;
    }
    if (!time.paused) {
      for (const s of shells) this.ask('gun', s.px, s.py, 0.75);
      for (const s of unseen) this.ask('gun', s.x, s.y, 0.75);
    }
    this.loops.update(
      engine,
      world,
      ear,
      (g) => {
        // What a voice does as it starts and stops is in the one-shots under its name: a laser's relay.
        if (`${g.voice}.on` in ONE_SHOTS) this.ask(`${g.voice}.on`, g.x, g.y, 1.2, 1, true);
        // A thruster lighting from cold pops (a missile leaving, a booster kicking in).
        if (g.voice === 'thruster') this.ask('ignite', g.x, g.y, Math.min(1, 0.35 + 0.15 * Math.sqrt(g.sum)));
      },
      (g) => {
        if (`${g.voice}.off` in ONE_SHOTS) this.ask(`${g.voice}.off`, g.x, g.y, 0.9);
      },
    );
    this.flush(engine, ear);
  }

  /** A new world: every loop stops and nothing queued plays. */
  clear(): void {
    this.pending = [];
    this.loops.clear();
    this.limiter.clear();
    this.shots = new ShotWatcher<Shell>();
    this.fired.clear();
    this.played.clear();
    this.engine?.stopOneShots();
  }

  dispose(): void {
    this.stopListening();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.loops.clear();
    this.engine?.dispose();
    this.engine = undefined;
  }

  private wake(): void {
    if (!this.engine) {
      try {
        this.engine = new AudioEngine(new AudioContext());
      } catch (err) {
        console.warn('sound: no audio in this browser', err);
        this.stopListening();
        return;
      }
      this.engine.setVolume(this.current.volume, this.current.muted);
      this.onChange?.();
    }
    // Not every first event lets a browser start audio (Escape, a touch): keep asking until it runs.
    const ctx = this.engine.ctx;
    if (ctx.state === 'running') this.stopListening();
    else void ctx.resume().then(() => ctx.state === 'running' && this.stopListening());
  }

  private stopListening(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
  }

  private ask(name: string, x: number, y: number, gain: number, rate = 1, must = false): void {
    this.pending.push({ name, x, y, gain, rate, ...(must ? { must } : {}) });
  }

  private materialOf(world: World, partType: string): string {
    let m = this.materials.get(partType);
    if (m === undefined) {
      const named = world.registry.has(partType) ? world.registry.get(partType).sound?.hit : undefined;
      m = material(named);
      if (named !== undefined && m !== named && !this.warned.has(named)) {
        this.warned.add(named);
        console.warn(`sound: no hit sound named "${named}" (part ${partType}), using metal`);
      }
      this.materials.set(partType, m);
    }
    return m;
  }

  /** Plays the queued one-shots the limiter lets through, each as the ear hears it. */
  private flush(engine: AudioEngine, ear: Ear): void {
    if (this.pending.length === 0) return;
    const asks = this.pending.map((p) => {
      const heard = hear(ear, p.x, p.y);
      // Far sounds arrive late (Logan: a toggle). Sim seconds, so fast forward shortens the wait.
      const after = this.current.delay ? heard.delay / this.timeScale : 0;
      return { ...p, heard, after, gain: p.gain * heard.gain, own: p.gain, seconds: (ONE_SHOTS[p.name]?.seconds ?? 0.3) / p.rate + after };
    });
    this.pending = [];
    for (const a of this.limiter.pick(asks, engine.now)) {
      // A gun's reports are timed to run one shot into the next, so its speed is left alone.
      engine.play(a.name, a.heard, a.own, a.after, a.name === 'gun' ? a.rate : a.rate * (0.94 + Math.random() * 0.12));
      this.played.set(a.name, (this.played.get(a.name) ?? 0) + 1);
    }
  }
}
