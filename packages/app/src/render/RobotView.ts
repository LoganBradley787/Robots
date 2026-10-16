import { AnimatedSprite, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { faceDir, footprintBox, footprintOf, opposite, recipePlacement, rootPartId, rotateCell, rotateFace, rotationRadians, type BodyGroup, type BodyId, type PartInstance, type PartRegistry, type PhysicsWorld, type Robot } from '@robots/sim-core';
import { interpolateState } from './interpolate';
import { bodyOrder, mountLayout, partLayout, type SpriteLayout } from './robotLayout';
import { damageTint } from './damageTint';
import { multiplyTint, teamTint } from './teamTint';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';
import { partSprites } from './partSprites';

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
  /** Batch: a swiveling thruster's flame turns with its swivel input (up to `deg` degrees, counterclockwise positive) from `base`. */
  swivel?: { deg: number; base: number };
}

/** What a robot is drawn with: part frames, fx animations, and the registry (M12: a bay's recipe ghosts). */
export interface RobotDrawing {
  frame: (name: string) => Texture;
  animations?: Animations;
  registry?: PartRegistry;
}

/** One rigid body's drawing: a Container that moves with it, its flames and glows behind its sprites. */
interface BodyView {
  bodyId: BodyId;
  view: Container;
  flames: Container;
}

/**
 * One part's drawing, kept while the part lasts (M16): when its robot is rebuilt it stays where it is, or moves to the
 * body (and the robot) the part is on now, instead of being drawn again.
 */
interface PartView {
  partId: string;
  body: BodyView;
  /** The part's offset from its body's origin it is drawn at, in meters: a new origin shifts it. */
  localX: number;
  localY: number;
  /** Its sprites, the last one its own (a stretchy cup's tiles come first). */
  sprites: Sprite[];
  /** The health it was last tinted for, and the lit look (M10 armed, M11 burning) it last showed. */
  health: number;
  plain?: Texture;
  lit?: Texture;
  on?: boolean;
  /** A glow over a flare (M11), shown while it burns and flickering. */
  glow?: Graphics;
  effect?: Effect;
}

/** A robot body about to be drawn: its parts, each with the drawing it had if any, and the body view it takes over. */
interface GroupPlan {
  group: BodyGroup;
  parts: { part: PartInstance; view: PartView | undefined }[];
  body?: BodyView;
}

/** One Container per rigid body, one Sprite per part at its body-local offset. Only containers move per frame. */
export class RobotView {
  readonly root = new Container();
  /** The robot's `version` this view was drawn for: a rebuild (damage, a split) redraws it (`syncAll`). */
  version: number;
  readonly robot: Robot;
  private readonly drawing: RobotDrawing;
  /** In draw order (joint bodies first). */
  private bodies: BodyView[] = [];
  private parts = new Map<string, PartView>();
  /** The mounts of joint parts, on the bodies they hang from: drawn again at every rebuild. */
  private mounts: Sprite[] = [];
  /**
   * What each fabricator bay is building (M12): its recipe's parts, bottom row first, shown faint one by one as the
   * build goes, and a progress bar across the bay's floor. Hidden while it holds a finished (real) copy.
   */
  private builds: { partId: string; ghosts: Container[]; bar: Graphics; barW: number }[] = [];
  /** Batch: the rod of each piston, drawn on the head's body from its rest cell to where the head is now. */
  private rods: { partId: string; jointId: number; rod: Graphics; dx: number; dy: number }[] = [];
  private frames = 0;

  /** A view of the robot drawn from scratch; `syncAll` keeps views up to date as robots are rebuilt. */
  constructor(robot: Robot, drawing: RobotDrawing, draw = true) {
    this.robot = robot;
    this.drawing = drawing;
    this.version = robot.version;
    if (draw) this.apply(this.plan(() => undefined));
  }

  /**
   * Brings the views up to date with the robots (M16): a robot gone loses its view, a new piece gets one, and a robot
   * rebuilt (it lost parts, split, or grew) is drawn again from the drawings it and the robots it broke from had. A
   * part still there keeps its sprites: on the same body they stay put, on another they move to that body's container,
   * and a body made of the parts of an old one takes over the old one's container (the one with most of its parts).
   * Only new parts are drawn new, and only the drawings of lost parts are destroyed. New views go on top of `layer`.
   */
  static syncAll(views: Map<number, RobotView>, robots: readonly Robot[], drawing: RobotDrawing, layer: Container): void {
    let changed = views.size !== robots.length;
    for (const r of robots) if (views.get(r.id)?.version !== r.version) changed = true;
    if (!changed) return;
    const live = new Map(robots.map((r) => [r.id, r]));
    // Views of robots rebuilt or gone give their drawings up; the parts still there are taken back below.
    const pools = new Map<number, Map<string, PartView>>();
    const parentOf = new Map<number, number>();
    const freed: BodyView[] = [];
    const gone: RobotView[] = [];
    for (const [id, v] of views) {
      const r = live.get(id);
      if (r !== undefined && r.version === v.version) continue;
      if (v.robot.brokeFrom !== undefined) parentOf.set(id, v.robot.brokeFrom);
      pools.set(id, v.release(freed));
      if (r !== undefined) continue;
      views.delete(id);
      gone.push(v);
    }
    for (const r of robots) if (r.brokeFrom !== undefined) parentOf.set(r.id, r.brokeFrom);
    // A part's drawing is with its robot's old view, or with the view of a robot it broke from (a piece of a piece
    // made since the last sync is two steps away).
    const take = (robotId: number, partId: string): PartView | undefined => {
      for (let at: number | undefined = robotId, hops = 0; at !== undefined && hops < 64; at = parentOf.get(at), hops++) {
        const pool = pools.get(at);
        const pv = pool?.get(partId);
        if (pv === undefined) continue;
        pool?.delete(partId);
        return pv;
      }
      return undefined;
    };
    const plans: { view: RobotView; groups: GroupPlan[] }[] = [];
    for (const r of robots) {
      let view = views.get(r.id);
      if (view !== undefined && !pools.has(r.id)) continue;
      if (view === undefined) {
        view = new RobotView(r, drawing, false);
        views.set(r.id, view);
        layer.addChild(view.root);
      }
      plans.push({ view, groups: view.plan((partId) => take(r.id, partId)) });
    }
    // Each old body goes to the new body with most of its parts; the others get new containers.
    const offers: { plan: GroupPlan; body: BodyView; count: number }[] = [];
    for (const { groups } of plans) {
      for (const plan of groups) {
        const count = new Map<BodyView, number>();
        for (const { view } of plan.parts) if (view) count.set(view.body, (count.get(view.body) ?? 0) + 1);
        for (const [body, n] of count) offers.push({ plan, body, count: n });
      }
    }
    offers.sort((a, b) => b.count - a.count);
    const claimed = new Set<BodyView>();
    for (const o of offers) {
      if (o.plan.body !== undefined || claimed.has(o.body)) continue;
      o.plan.body = o.body;
      claimed.add(o.body);
    }
    for (const { view, groups } of plans) view.apply(groups);
    // What is left is lost: on a body still drawn, part by part; the rest with their bodies.
    for (const pool of pools.values()) for (const pv of pool.values()) if (claimed.has(pv.body)) disposePart(pv);
    for (const b of freed) if (!claimed.has(b)) b.view.destroy({ children: true });
    for (const v of gone) v.root.destroy({ children: true });
  }

  /** Gives up this view's drawing for a redraw: its parts' drawings (returned) and its bodies (into `freed`). */
  private release(freed: BodyView[]): Map<string, PartView> {
    for (const m of this.mounts) m.destroy();
    for (const r of this.rods) r.rod.destroy();
    for (const b of this.builds) {
      for (const g of b.ghosts) g.destroy({ children: true });
      b.bar.destroy();
    }
    this.mounts = [];
    this.rods = [];
    this.builds = [];
    freed.push(...this.bodies);
    this.bodies = [];
    const parts = this.parts;
    this.parts = new Map();
    return parts;
  }

  /** The robot's bodies as they are now, each part with the drawing `take` finds for it. */
  private plan(take: (partId: string) => PartView | undefined): GroupPlan[] {
    return this.robot.groups.map((group) => {
      const parts: GroupPlan['parts'] = [];
      for (const id of group.partIds) {
        const part = this.robot.parts.get(id);
        if (part) parts.push({ part, view: take(id) });
      }
      return { group, parts };
    });
  }

  /** Draws the robot as planned: parts kept, moved or drawn new, then mounts, rods and bays, bodies in draw order. */
  private apply(groups: GroupPlan[]): void {
    const robot = this.robot;
    this.version = robot.version;
    const bodies = groups.map((g) => {
      const body = g.body ?? newBody();
      body.bodyId = g.group.bodyId;
      return body;
    });
    const parts = new Map<string, PartView>();
    groups.forEach((g, i) => {
      const body = bodies[i] as BodyView;
      for (const { part, view } of g.parts) parts.set(part.id, view ? movePart(view, part, body) : this.drawPart(part, body));
    });
    this.parts = parts;
    for (const g of robot.groups) {
      const m = mountLayout(robot, g);
      const parent = m ? bodies[m.parentGroup] : undefined;
      if (!m || !parent) continue;
      const sprite = this.sprite(m.sprite);
      parent.view.addChild(sprite);
      this.mounts.push(sprite);
    }
    const order = groups.map((g, i) => ({ group: g.group.index, body: bodies[i] as BodyView })).sort(bodyOrder(robot));
    for (const { group, body } of order) {
      this.addRod(group, body.view);
      if (this.drawing.registry) this.addBuilds(group, body.view, this.drawing.frame, this.drawing.registry);
    }
    this.bodies = order.map((o) => o.body);
    const views = this.bodies.map((b) => b.view);
    if (views.length !== this.root.children.length || views.some((v, i) => this.root.children[i] !== v)) {
      this.root.removeChildren();
      if (views.length > 0) this.root.addChild(...views);
    }
  }

  /** A sprite as laid out, at its place on its body. */
  private sprite(s: SpriteLayout): Sprite {
    const sprite = new Sprite(this.drawing.frame(s.frame));
    place(sprite, s);
    return sprite;
  }

  /** A part drawn new on a body: its sprites, and its glow and flame behind them. */
  private drawPart(part: PartInstance, body: BodyView): PartView {
    const { frame, animations } = this.drawing;
    const def = part.def;
    const pv: PartView = { partId: part.id, body, localX: part.localX, localY: part.localY, sprites: [], health: Number.NaN };
    const layout = partLayout(part);
    for (const s of layout) {
      let sprite: Sprite;
      if (s.animation && animations && s.channel) {
        const spin = new AnimatedSprite(animations(s.animation));
        spin.animationSpeed = 0;
        place(spin, s);
        (pv.effect ??= { partId: part.id, channel: s.channel, max: 1 }).spin = spin;
        sprite = spin;
      } else {
        sprite = this.sprite(s);
      }
      body.view.addChild(sprite);
      pv.sprites.push(sprite);
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
        const effect = (pv.effect ??= { partId: part.id, channel: s.channel, max: 1 });
        effect.flame = flame;
        const swivelDeg = def.behaviorConfig?.swivel ?? 0;
        if (swivelDeg > 0) effect.swivel = { deg: swivelDeg, base: s.rotation };
      }
    }
    if (pv.effect) pv.effect.max = def.inputs.find((c) => c.name === pv.effect?.channel)?.max ?? 1;
    const own = layout[layout.length - 1] as SpriteLayout;
    // A part that needs arming (M10) swaps to its armed frame once armed; a decoy (M11) to its lit frame while it burns.
    const litName = def.arming === true ? def.sprite.armedFrame : def.decoy !== undefined || def.jammer !== undefined ? def.sprite.litFrame : undefined;
    if (litName !== undefined && !own.animation && !def.sprite.tiles) {
      pv.plain = (pv.sprites[pv.sprites.length - 1] as Sprite).texture;
      pv.lit = frame(litName);
    }
    if (def.decoy !== undefined || def.jammer !== undefined) {
      const glow = new Graphics();
      // Batch: a jamming pod glows cyan instead of orange.
      const rings = def.jammer !== undefined ? ([[1.6, 0x2ab6d8, 0.12], [1.0, 0x4fe3ff, 0.22], [0.5, 0xc8f6ff, 0.5]] as const) : ([[1.6, 0xff8a2a, 0.12], [1.0, 0xffc04a, 0.22], [0.5, 0xfff2c0, 0.5]] as const);
      for (const [r, color, alpha] of rings) glow.circle(0, 0, r * PIXELS_PER_METER).fill({ color, alpha });
      glow.blendMode = 'add';
      const p = toScreen(own);
      glow.position.set(p.x, p.y);
      glow.visible = false;
      body.flames.addChild(glow);
      pv.glow = glow;
    }
    if (pv.effect?.flame) body.flames.addChild(pv.effect.flame);
    return pv;
  }

  /** Batch: a piston's rod, on the body of its head (which slides), from the head back toward its sleeve. */
  private addRod(group: number, view: Container): void {
    const joint = this.robot.groups[group]?.joint;
    const part = joint ? this.robot.parts.get(joint.partId) : undefined;
    if (!joint || !part || part.def.joint?.kind !== 'prismatic') return;
    const way = faceDir(opposite(rotateFace(part.def.joint.mountFace, part.rot)));
    const rod = new Graphics();
    // Under the head's sprites (over the flames, which come first), so the plate covers its end.
    view.addChildAt(rod, 1);
    this.rods.push({ partId: part.id, jointId: joint.jointId, rod, dx: -way.x, dy: -way.y });
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
          // One ghost per part, drawn as the part is (a sized bay in a recipe too).
          const c = new Container();
          for (const t of partSprites(def, rot, footprintOf(def, p.size))) {
            const s = new Sprite(frame(t.frame));
            s.anchor.set(0.5);
            s.width = PIXELS_PER_METER * t.w;
            s.height = PIXELS_PER_METER * t.h;
            if (t.flip) s.scale.x *= -1;
            const pos = toScreen({ x: where.at.x + off.x - ox + t.x, y: where.at.y + off.y - oy + t.y });
            s.position.set(pos.x, pos.y);
            s.rotation = toScreenAngle(rotationRadians(rot));
            c.addChild(s);
          }
          c.alpha = 0.4;
          c.visible = false;
          view.addChild(c);
          // The recipe sits in the bay as it is (turned only with the bay), so its own rows are the bay's, bottom first.
          return { s: c, order: p.y };
        })
        .sort((a, b) => a.order - b.order)
        .map((g) => g.s);
      const bar = new Graphics();
      // Across the floor under the whole hollow, however wide the bay is.
      const width = footprintBox(bay.def, bay.footprint).w - 2;
      const floor = rotateCell({ x: (width - 1) / 2, y: -0.38 }, bay.rot);
      const p = toScreen({ x: bay.localX + floor.x, y: bay.localY + floor.y });
      bar.position.set(p.x, p.y);
      bar.rotation = toScreenAngle(rotationRadians(bay.rot));
      view.addChild(bar);
      this.builds.push({ partId: bay.id, ghosts, bar, barW: PIXELS_PER_METER * (width + 1.6) });
    }
  }

  sync(physics: PhysicsWorld, alpha: number, value?: (partId: string, channel: string) => number | undefined): void {
    for (const b of this.bodies) {
      const s = interpolateState(physics.prevState(b.bodyId), physics.state(b.bodyId), alpha);
      const p = toScreen(s);
      b.view.position.set(p.x, p.y);
      b.view.rotation = toScreenAngle(s.angle);
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
    for (const r of this.rods) {
      const len = physics.sliderPosition(r.jointId);
      r.rod.clear();
      if (len < 0.02) continue;
      const w = 0.22 * PIXELS_PER_METER;
      const l = len * PIXELS_PER_METER;
      // The head's origin is its cell (the body origin, drawn at the view's origin); the rod's middle is half its length back.
      const c = toScreen({ x: (r.dx * len) / 2, y: (r.dy * len) / 2 });
      const vertical = r.dx === 0;
      const [rw, rh] = vertical ? [w, l] : [l, w];
      r.rod.rect(c.x - rw / 2, c.y - rh / 2, rw, rh).fill({ color: 0x8a9099 }).stroke({ color: 0x454a52, width: 2 });
    }
    this.frames++;
    for (const p of this.parts.values()) {
      const part = this.robot.parts.get(p.partId);
      if (!part) continue;
      const on = part.armed === true || (part.burn ?? 0) > 0;
      if (p.lit && on !== p.on) {
        p.on = on;
        const sprite = p.sprites[p.sprites.length - 1] as Sprite;
        sprite.texture = (on ? p.lit : p.plain) ?? sprite.texture;
        sprite.width = PIXELS_PER_METER * (part.def.footprint.length === 1 ? 1 : footprintBox(part.def, part.footprint).w);
        sprite.height = PIXELS_PER_METER * (part.def.footprint.length === 1 ? 1 : footprintBox(part.def, part.footprint).h);
      }
      if (part.health !== p.health) {
        p.health = part.health;
        const tint = multiplyTint(damageTint(part.health / part.def.health), teamTint(this.robot.team));
        for (const sprite of p.sprites) sprite.tint = tint;
      }
      if (p.glow) {
        p.glow.visible = (part.burn ?? 0) > 0;
        if (p.glow.visible) p.glow.alpha = 0.75 + 0.25 * Math.sin(this.frames * 0.9 + p.glow.x);
      }
      const e = p.effect;
      if (!e) continue;
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
        if (e.swivel) {
          const tilt = Math.max(-1, Math.min(1, value?.(e.partId, 'swivel') ?? 0)) * e.swivel.deg * (Math.PI / 180);
          e.flame.rotation = toScreenAngle(e.swivel.base + tilt);
        }
      }
    }
  }
}

/** A body's view: its container, with the container of its flames and glows first, so they draw behind its sprites. */
function newBody(): BodyView {
  const view = new Container();
  const flames = new Container();
  view.addChild(flames);
  return { bodyId: 0, view, flames };
}

/** Sets a sprite to its layout: centered, sized to its cells, mirrored if flipped, at its place on its body. */
function place(sprite: Sprite, s: SpriteLayout): void {
  sprite.anchor.set(0.5);
  sprite.width = PIXELS_PER_METER * s.w;
  sprite.height = PIXELS_PER_METER * s.h;
  if (s.flip) sprite.scale.x *= -1;
  const p = toScreen(s);
  sprite.position.set(p.x, p.y);
  sprite.rotation = toScreenAngle(s.rotation);
}

/**
 * A part's drawing onto the body it is on now: shifted by how far its body's origin moved (a body that lost its first
 * part starts at another), and into that body's containers if it was on another. Turned the same: a rebuilt body
 * keeps the angle of the one its parts were on.
 */
function movePart(pv: PartView, part: PartInstance, body: BodyView): PartView {
  const dx = part.localX - pv.localX;
  const dy = part.localY - pv.localY;
  if (dx !== 0 || dy !== 0) {
    const d = toScreen({ x: dx, y: dy });
    for (const s of pv.sprites) s.position.set(s.x + d.x, s.y + d.y);
    pv.glow?.position.set(pv.glow.x + d.x, pv.glow.y + d.y);
    pv.effect?.flame?.position.set(pv.effect.flame.x + d.x, pv.effect.flame.y + d.y);
    pv.localX = part.localX;
    pv.localY = part.localY;
  }
  if (pv.body !== body) {
    for (const s of pv.sprites) body.view.addChild(s);
    if (pv.glow) body.flames.addChild(pv.glow);
    if (pv.effect?.flame) body.flames.addChild(pv.effect.flame);
    pv.body = body;
  }
  return pv;
}

/** A lost part's drawing, gone from its body. */
function disposePart(pv: PartView): void {
  for (const s of pv.sprites) s.destroy();
  pv.glow?.destroy();
  pv.effect?.flame?.destroy();
}
