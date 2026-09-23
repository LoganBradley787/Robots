import { AnimatedSprite, Container, Sprite, type Texture } from 'pixi.js';
import type { BodyId, PhysicsWorld, Robot } from '@robots/sim-core';
import { interpolateState } from './interpolate';
import { layoutRobot } from './robotLayout';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

/** Looks up an fx animation's frames by name. */
export type Animations = (name: string) => Texture[];

/** A part effect driven by one input channel: 0 is off, the channel max is full. */
interface Effect {
  partId: string;
  channel: string;
  max: number;
  /** Propeller spin: plays faster with the channel, holds a frame at zero. */
  spin?: AnimatedSprite;
  /** Thruster flame: shown above zero, longer and brighter with the channel. */
  flame?: AnimatedSprite;
}

/** One Container per rigid body, one Sprite per part at its body-local offset. Only containers move per frame. */
export class RobotView {
  readonly root = new Container();
  private readonly bodies: { bodyId: BodyId; view: Container }[] = [];
  private readonly effects: Effect[] = [];

  constructor(robot: Robot, frame: (name: string) => Texture, animations?: Animations) {
    for (const body of layoutRobot(robot)) {
      const view = new Container();
      const flames = new Container();
      for (const s of body.sprites) {
        const def = robot.parts.get(s.partId)?.def;
        const max = def?.inputs.find((c) => c.name === s.channel)?.max ?? 1;
        const effect: Effect = { partId: s.partId, channel: s.channel ?? '', max };
        let sprite: Sprite;
        if (s.animation && animations && s.channel) {
          const spin = new AnimatedSprite(animations(s.animation));
          spin.animationSpeed = 0;
          effect.spin = spin;
          sprite = spin;
        } else {
          sprite = new Sprite(frame(s.frame));
        }
        sprite.anchor.set(0.5);
        sprite.width = PIXELS_PER_METER;
        sprite.height = PIXELS_PER_METER;
        const p = toScreen(s);
        sprite.position.set(p.x, p.y);
        sprite.rotation = toScreenAngle(s.rotation);
        view.addChild(sprite);
        if (s.overlay && animations && s.channel) {
          const flame = new AnimatedSprite(animations(s.overlay.name));
          flame.anchor.set(0.5, 0);
          flame.width = PIXELS_PER_METER;
          flame.height = PIXELS_PER_METER;
          const o = toScreen(s.overlay);
          flame.position.set(o.x, o.y);
          flame.rotation = toScreenAngle(s.rotation);
          flame.visible = false;
          flame.animationSpeed = 0.35;
          flame.play();
          flames.addChild(flame);
          effect.flame = flame;
        }
        if (effect.spin || effect.flame) this.effects.push(effect);
      }
      // Flames draw behind the body so they come out of the nozzle, not over the frame.
      view.addChildAt(flames, 0);
      this.root.addChild(view);
      this.bodies.push({ bodyId: body.bodyId, view });
    }
  }

  sync(physics: PhysicsWorld, alpha: number, value?: (partId: string, channel: string) => number | undefined): void {
    for (const b of this.bodies) {
      const s = interpolateState(physics.prevState(b.bodyId), physics.state(b.bodyId), alpha);
      const p = toScreen(s);
      b.view.position.set(p.x, p.y);
      b.view.rotation = toScreenAngle(s.angle);
    }
    for (const e of this.effects) {
      const t = Math.max(0, Math.min(1, (value?.(e.partId, e.channel) ?? 0) / e.max));
      if (e.spin) {
        if (t > 0 && !e.spin.playing) e.spin.play();
        if (t === 0 && e.spin.playing) e.spin.gotoAndStop(0);
        e.spin.animationSpeed = 0.15 + 0.6 * t;
      }
      if (e.flame) {
        e.flame.visible = t > 0;
        e.flame.alpha = 0.45 + 0.55 * t;
        e.flame.height = PIXELS_PER_METER * (0.45 + 0.75 * t);
      }
    }
  }
}
