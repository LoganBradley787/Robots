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
}

/** Events older than this many ticks are not played (a frame hitch, a tab coming back). */
const STALE_TICKS = 30;
/** A group's thrusters pop when they light, at most this often, seconds. */
const IGNITE_EVERY = 0.4;

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
  private readonly ignited = new Map<string, number>();
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

  /** False until the first click or key press has let the browser start audio. */
  get awake(): boolean {
    return this.engine !== undefined;
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
    switch (ev.kind) {
      case 'explosion':
        this.ask(explosionFor(ev.radius), ev.x, ev.y, Math.min(1.5, 0.6 + ev.radius / 6));
        break;
      case 'partDestroyed':
        // A part that explodes gets the blast, a burnt-out flare just goes out (as the effects do).
        if (!ev.exploded && ev.burntOut !== true) this.ask(`break.${this.materialOf(world, ev.partType)}`, ev.x, ev.y, 0.55);
        break;
      case 'shellHit':
        this.ask(`hit.${this.materialOf(world, ev.partType)}`, ev.x, ev.y, 0.4);
        break;
      case 'decoupled':
        this.ask('decouple', ev.x, ev.y, 0.6);
        break;
      case 'impact': {
        // Louder the harder it hit and the heavier it is; lower the heavier it is.
        const hard = Math.min(1, (ev.dv - 2) / 14);
        const weight = Math.min(1.6, Math.max(0.25, Math.sqrt(ev.mass) / 5));
        const gain = (0.25 + 0.75 * hard) * weight;
        this.ask('thud', ev.x, ev.y, gain, Math.min(1.4, Math.max(0.55, 1.5 - 0.35 * Math.log10(1 + ev.mass))));
        if (ev.dv > 8) this.ask('rattle', ev.x, ev.y, gain * 0.5);
        break;
      }
      default:
        break;
    }
  }

  /** Once per drawn frame: moves the ear to the camera, plays what was queued, and updates the loops. */
  frame(world: World, cam: { x: number; y: number; zoom: number }, screenWidth: number, time: { paused: boolean; timeScale: number }): void {
    // Shots are counted even with no audio yet, so waking up mid-fight does not play every shell in flight.
    const fired = this.shots.fresh(world.liveShells());
    for (const s of this.shots.fresh(world.spentShells())) fired.push(s);
    const engine = this.engine;
    if (!engine) return;
    engine.setPaused(time.paused);
    this.timeScale = time.timeScale;
    const ear: Ear = { x: cam.x, y: cam.y, zoom: cam.zoom, halfWidth: screenWidth / 2 / (cam.zoom * PIXELS_PER_METER) };
    if (this.current.muted || !engine.ready) {
      this.pending = [];
      this.loops.clear();
      return;
    }
    if (!time.paused) for (const s of fired) this.ask('gun', s.px, s.py, 0.5);
    this.loops.update(
      engine,
      world,
      ear,
      (g) => {
        if (g.voice === 'laser') this.ask('laser.on', g.x, g.y, 0.5);
        if (g.voice !== 'thruster') return;
        // A thruster lighting from cold pops (a missile leaving, a booster kicking in), but not on every flicker.
        if (engine.now - (this.ignited.get(g.key) ?? -1) < IGNITE_EVERY) return;
        this.ignited.set(g.key, engine.now);
        this.ask('ignite', g.x, g.y, Math.min(1, 0.35 + 0.15 * Math.sqrt(g.sum)));
      },
      (g) => {
        if (g.voice === 'laser') this.ask('laser.off', g.x, g.y, 0.45);
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
    this.ignited.clear();
    this.played.clear();
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.loops.clear();
    this.engine?.dispose();
    this.engine = undefined;
  }

  private wake(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    if (this.engine) return;
    try {
      this.engine = new AudioEngine(new AudioContext());
    } catch (err) {
      console.warn('sound: no audio in this browser', err);
      return;
    }
    this.engine.setVolume(this.current.volume, this.current.muted);
    this.onChange?.();
  }

  private ask(name: string, x: number, y: number, gain: number, rate = 1): void {
    this.pending.push({ name, x, y, gain, rate });
  }

  private materialOf(world: World, partType: string): string {
    let m = this.materials.get(partType);
    if (m === undefined) {
      m = material(world.registry.has(partType) ? world.registry.get(partType).sound?.hit : undefined);
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
      engine.play(a.name, a.heard, a.own, a.after, a.rate * (0.92 + Math.random() * 0.16));
      this.played.set(a.name, (this.played.get(a.name) ?? 0) + 1);
    }
  }
}
