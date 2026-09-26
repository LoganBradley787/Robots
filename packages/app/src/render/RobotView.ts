import { AnimatedSprite, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { footprintBox, recipePlacement, rootPartId, rotateCell, rotationRadians, type BodyId, type PartRegistry, type PhysicsWorld, type Robot } from '@robots/sim-core';
import { interpolateState } from './interpolate';
import { layoutRobot } from './robotLayout';
import { damageTint } from './damageTint';
import { multiplyTint, teamTint } from './teamTint';
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
  /** The robot's `version` this view was built for: a rebuild (damage, a split) needs a new view. */
  readonly version: number;
  private readonly robot: Robot;
  private readonly bodies: { bodyId: BodyId; view: Container }[] = [];
  private readonly effects: Effect[] = [];
  /** Part sprites with the health they were last tinted for, and the lit look (M10 armed, M11 burning) they last showed. */
  private readonly parts: { partId: string; sprite: Sprite; health: number; plain?: Texture; lit?: Texture; on?: boolean }[] = [];
  /** A glow over each flare (M11), shown while it burns and flickering. */
  private readonly glows: { partId: string; glow: Graphics }[] = [];
  /**
   * What each fabricator bay is building (M12): its recipe's parts, bottom row first, shown faint one by one as the
   * build goes, and a progress bar across the bay's floor. Hidden while it holds a finished (real) copy.
   */
  private readonly builds: { partId: string; ghosts: Sprite[]; bar: Graphics; barW: number }[] = [];
  private frames = 0;

  constructor(robot: Robot, frame: (name: string) => Texture, animations?: Animations, registry?: PartRegistry) {
    this.robot = robot;
    this.version = robot.version;
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
        sprite.width = PIXELS_PER_METER * s.w;
        sprite.height = PIXELS_PER_METER * s.h;
        if (s.flip) sprite.scale.x *= -1;
        const p = toScreen(s);
        sprite.position.set(p.x, p.y);
        sprite.rotation = toScreenAngle(s.rotation);
        view.addChild(sprite);
        if (s.kind === 'part') {
          // A part that needs arming (M10) swaps to its armed frame once armed; a decoy (M11) to its lit frame while it burns.
          const litName = def?.arming === true ? def.sprite.armedFrame : def?.decoy !== undefined ? def.sprite.litFrame : undefined;
          const lit = litName !== undefined && !s.animation && !def?.sprite.tiles ? frame(litName) : undefined;
          this.parts.push({ partId: s.partId, sprite, health: Number.NaN, ...(lit ? { plain: sprite.texture, lit } : {}) });
        }
        if (s.kind === 'part' && def?.decoy !== undefined) {
          const glow = new Graphics();
          for (const [r, color, alpha] of [[1.6, 0xff8a2a, 0.12], [1.0, 0xffc04a, 0.22], [0.5, 0xfff2c0, 0.5]] as const) glow.circle(0, 0, r * PIXELS_PER_METER).fill({ color, alpha });
          glow.blendMode = 'add';
          glow.position.set(p.x, p.y);
          glow.visible = false;
          flames.addChild(glow);
          this.glows.push({ partId: s.partId, glow });
        }
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
      if (registry) this.addBuilds(body.group, view, frame, registry);
      // Flames draw behind the body so they come out of the nozzle, not over the frame.
      view.addChildAt(flames, 0);
      this.root.addChild(view);
      this.bodies.push({ bodyId: body.bodyId, view });
    }
  }

  /** The ghost of each bay's recipe on this body (M12), laid out where the finished copy will sit. */
  private addBuilds(group: number, view: Container, frame: (name: string) => Texture, registry: PartRegistry): void {
    for (const placed of this.robot.blueprint.parts) {
      const bay = this.robot.parts.get(placed.id);
      const recipe = placed.makes === undefined ? undefined : this.robot.blueprint.recipes?.find((r) => r.name === placed.makes);
      if (!bay || bay.group !== group || !bay.def.fabricate || !recipe) continue;
      const where = recipePlacement(placed, recipe.blueprint, registry);
      const rootId = rootPartId(recipe.blueprint, registry);
      const root = recipe.blueprint.parts.find((p) => p.id === rootId);
      if (!where.ok || !root) continue;
      // Cells to this body's frame: the bay's cell sits at its localX, localY.
      const ox = bay.x - bay.localX;
      const oy = bay.y - bay.localY;
      const ghosts = recipe.blueprint.parts
        .filter((p) => registry.has(p.part))
        .map((p) => {
          const off = rotateCell({ x: p.x - root.x, y: p.y - root.y }, where.rot);
          const rot = ((p.rot + where.rot) % 360) as 0 | 90 | 180 | 270;
          const def = registry.get(p.part);
          const box = footprintBox(def);
          const b = rotateCell({ x: box.cx, y: box.cy }, rot);
          const s = new Sprite(frame(def.sprite.frame));
          s.anchor.set(0.5);
          s.width = PIXELS_PER_METER * box.w;
          s.height = PIXELS_PER_METER * box.h;
          const pos = toScreen({ x: where.at.x + off.x - ox + b.x, y: where.at.y + off.y - oy + b.y });
          s.position.set(pos.x, pos.y);
          s.rotation = toScreenAngle(rotationRadians(rot));
          s.alpha = 0.4;
          s.visible = false;
          view.addChild(s);
          // The recipe sits in the bay as it is (turned only with the bay), so its own rows are the bay's, bottom first.
          return { s, order: p.y };
        })
        .sort((a, b) => a.order - b.order)
        .map((g) => g.s);
      const bar = new Graphics();
      const floor = rotateCell({ x: 0, y: -0.38 }, bay.rot);
      const p = toScreen({ x: bay.localX + floor.x, y: bay.localY + floor.y });
      bar.position.set(p.x, p.y);
      bar.rotation = toScreenAngle(rotationRadians(bay.rot));
      view.addChild(bar);
      this.builds.push({ partId: bay.id, ghosts, bar, barW: PIXELS_PER_METER * 2.6 });
    }
  }

  sync(physics: PhysicsWorld, alpha: number, value?: (partId: string, channel: string) => number | undefined): void {
    for (const b of this.bodies) {
      const s = interpolateState(physics.prevState(b.bodyId), physics.state(b.bodyId), alpha);
      const p = toScreen(s);
      b.view.position.set(p.x, p.y);
      b.view.rotation = toScreenAngle(s.angle);
    }
    for (const p of this.parts) {
      const part = this.robot.parts.get(p.partId);
      const on = part?.armed === true || (part?.burn ?? 0) > 0;
      if (p.lit && part && on !== p.on) {
        p.on = on;
        p.sprite.texture = (on ? p.lit : p.plain) ?? p.sprite.texture;
        p.sprite.width = PIXELS_PER_METER * (part.def.footprint.length === 1 ? 1 : footprintBox(part.def, part.footprint).w);
        p.sprite.height = PIXELS_PER_METER * (part.def.footprint.length === 1 ? 1 : footprintBox(part.def, part.footprint).h);
      }
      if (!part || part.health === p.health) continue;
      p.health = part.health;
      p.sprite.tint = multiplyTint(damageTint(part.health / part.def.health), teamTint(this.robot.team));
    }
    for (const b of this.builds) {
      const bay = this.robot.parts.get(b.partId);
      const building = bay !== undefined && bay.holding !== true && (bay.progress ?? 0) > 0;
      const progress = building ? (bay?.progress ?? 0) : 0;
      const shown = building ? Math.min(b.ghosts.length, Math.floor(progress * b.ghosts.length) + 1) : 0;
      b.ghosts.forEach((g, i) => (g.visible = i < shown));
      b.bar.clear();
      if (building) b.bar.rect(-b.barW / 2, -3, b.barW * progress, 6).fill({ color: 0x38d6ff, alpha: 0.9 });
    }
    this.frames++;
    for (const g of this.glows) {
      const part = this.robot.parts.get(g.partId);
      g.glow.visible = (part?.burn ?? 0) > 0;
      if (g.glow.visible) g.glow.alpha = 0.75 + 0.25 * Math.sin(this.frames * 0.9 + g.glow.x);
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
