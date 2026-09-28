import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_METER, toScreen } from './units';

/** One short-lived visual. `t` counts up in seconds; the effect is removed after `life`. */
interface Effect {
  g: Graphics;
  t: number;
  life: number;
  draw(g: Graphics, t: number): void;
}

const FLASH = 0xfff1b8;
const FIRE = 0xff9a3c;
const SMOKE = 0x57514c;
const DUST = 0x8a8178;

/**
 * Cosmetic effects on top of the robots, driven by world events (M6): a blast's flash, fireball, shock ring, and
 * smoke; a puff where a part breaks. Nothing here touches the simulation, so wall-clock time and Math.random are
 * fine. Positions are in meters (physics frame).
 */
export class Effects {
  readonly root = new Container();
  private readonly live: Effect[] = [];

  explosion(x: number, y: number, radius: number): void {
    const p = toScreen({ x, y });
    const r = radius * PIXELS_PER_METER;
    this.add(p, 0.12, (g, t) => {
      const k = t / 0.12;
      g.circle(0, 0, r * (0.35 + 0.3 * k)).fill({ color: FLASH, alpha: 0.9 * (1 - k) });
    });
    this.add(p, 0.45, (g, t) => {
      const k = t / 0.45;
      g.circle(0, 0, r * (0.25 + 0.45 * Math.sqrt(k))).fill({ color: FIRE, alpha: 0.75 * (1 - k) ** 1.5 });
    });
    this.add(p, 0.35, (g, t) => {
      const k = t / 0.35;
      g.circle(0, 0, r * (0.3 + 1.1 * k)).stroke({ color: FLASH, width: 3 * (1 - k) + 1, alpha: 0.6 * (1 - k) });
    });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (0.4 + Math.random() * 0.8) * r;
      const size = (0.15 + Math.random() * 0.2) * r;
      const life = 1 + Math.random() * 0.8;
      this.add(p, life, (g, t) => {
        const k = t / life;
        const drift = 1 - (1 - k) ** 2;
        // Screen y points down: smoke rises, so it drifts toward negative y.
        g.circle(Math.cos(a) * speed * drift, Math.sin(a) * speed * drift * 0.6 - r * 0.6 * k, size * (0.6 + 0.8 * k)).fill({ color: SMOKE, alpha: 0.55 * (1 - k) });
      });
    }
  }

  /** A part broke: a small burst of dust and a few chips. */
  breakPuff(x: number, y: number): void {
    const p = toScreen({ x, y });
    const r = 0.6 * PIXELS_PER_METER;
    this.add(p, 0.5, (g, t) => {
      const k = t / 0.5;
      g.circle(0, 0, r * (0.4 + 0.6 * k)).fill({ color: DUST, alpha: 0.5 * (1 - k) });
    });
    for (let i = 0; i < 4; i++) {
      const vx = (Math.random() - 0.5) * 4 * r;
      const vy = -(0.5 + Math.random()) * 2.5 * r;
      const life = 0.5 + Math.random() * 0.3;
      this.add(p, life, (g, t) => {
        // A chip flies out and falls (screen y down is +).
        g.rect(vx * t - 2, vy * t + 9 * r * t * t - 2, 4, 4).fill({ color: DUST, alpha: 1 - t / life });
      });
    }
  }

  /** A decoupler fired: a quick spark at its release face. */
  spark(x: number, y: number): void {
    const p = toScreen({ x, y });
    const r = 0.4 * PIXELS_PER_METER;
    this.add(p, 0.18, (g, t) => {
      const k = t / 0.18;
      g.circle(0, 0, r * (0.5 + k)).fill({ color: FLASH, alpha: 0.8 * (1 - k) });
    });
  }

  /** A shell hit something (M13): a tiny spark. */
  hit(x: number, y: number): void {
    const p = toScreen({ x, y });
    const r = 0.25 * PIXELS_PER_METER;
    this.add(p, 0.1, (g, t) => {
      const k = t / 0.1;
      g.circle(0, 0, r * (0.4 + k)).fill({ color: FLASH, alpha: 0.9 * (1 - k) });
    });
  }

  /** Advances every effect by `dt` seconds and drops finished ones. */
  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i] as Effect;
      e.t += dt;
      if (e.t >= e.life) {
        e.g.destroy();
        this.live.splice(i, 1);
        continue;
      }
      e.g.clear();
      e.draw(e.g, e.t);
    }
  }

  clear(): void {
    for (const e of this.live) e.g.destroy();
    this.live.length = 0;
  }

  private add(at: { x: number; y: number }, life: number, draw: (g: Graphics, t: number) => void): void {
    const g = new Graphics();
    g.position.set(at.x, at.y);
    this.root.addChild(g);
    const e: Effect = { g, t: 0, life, draw };
    draw(g, 0);
    this.live.push(e);
  }
}
