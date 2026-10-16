import { describe, expect, it } from 'vitest';
import { AnimatedSprite, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { World, parseWorldFile, type Robot } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { RobotView, type RobotDrawing } from '../src/render/RobotView';

// M16: a robot that loses parts keeps the drawings of the parts it still has; these check the bookkeeping against a
// view drawn from scratch, no GPU needed.

// Flames and spinning blades play on Pixi's ticker, which asks for animation frames: here they never come.
const g = globalThis as { requestAnimationFrame?: (f: () => void) => number; cancelAnimationFrame?: (id: number) => void };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => undefined;

const textures = new Map<string, Texture>();
const frame = (name: string): Texture => {
  let t = textures.get(name);
  if (!t) {
    t = new Texture({ label: name });
    textures.set(name, t);
  }
  return t;
};

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0; // + 0: -0 is 0

/** What a display object shows, as plain data: sprites by frame, place and look; containers by their children. */
function shape(o: Container): unknown {
  const at = { x: r3(o.x), y: r3(o.y), rotation: r3(o.rotation), visible: o.visible };
  if (o instanceof Sprite) return { frame: o.texture.label, ...at, sx: r3(o.scale.x), sy: r3(o.scale.y), tint: o.tint, spin: o instanceof AnimatedSprite };
  if (o instanceof Graphics) return { graphics: true, ...at };
  return { ...at, alpha: o.alpha, children: o.children.map((c) => shape(c)) };
}

/** Every sprite under a container. */
function sprites(c: Container, out = new Set<Sprite>()): Set<Sprite> {
  for (const ch of c.children) {
    if (ch instanceof Sprite) out.add(ch);
    else sprites(ch, out);
  }
  return out;
}

async function scene(raw: unknown, at = { x: 0, y: 3 }) {
  const w = await World.create({ seed: 1 }, parseWorldFile(flatJson));
  w.spawnBlueprint(raw, at);
  const drawing: RobotDrawing = { frame, animations: (name) => [frame(name)], registry: w.registry };
  const views = new Map<number, RobotView>();
  const layer = new Container();
  const show = (v: RobotView, id: number): void => v.sync(w.physics, 1, (partId, channel) => w.channelValue(id, partId, channel));
  return {
    w,
    views,
    layer,
    sync(): void {
      RobotView.syncAll(views, w.robots, drawing, layer);
      for (const [id, v] of views) show(v, id);
    },
    /** The robot drawn from scratch. */
    fresh(r: Robot): unknown {
      const v = new RobotView(r, drawing);
      show(v, r.id);
      const s = shape(v.root);
      v.root.destroy({ children: true });
      return s;
    },
    lose(robotId: number, ...ids: string[]): void {
      for (const id of ids) {
        const p = w.robotById(robotId)?.parts.get(id);
        if (!p) throw new Error(`robot ${robotId} has no part ${id}`);
        p.health = 0;
      }
    },
  };
}

type Scene = Awaited<ReturnType<typeof scene>>;

/** Every view draws its robot as a fresh view would, and the layer holds exactly those views. */
function expectFresh(s: Scene): void {
  expect([...s.views.keys()]).toEqual(s.w.robots.map((r) => r.id));
  expect(s.layer.children).toEqual([...s.views.values()].map((v) => v.root));
  for (const r of s.w.robots) expect(shape((s.views.get(r.id) as RobotView).root)).toEqual(s.fresh(r));
}

const SLAB = { format: 1, name: 'slab', grid: ['F F F F F F', 'F F F F F F', 'F F F F F F', 'C F F F F F'] };

describe('RobotView.syncAll', () => {
  it('a robot that loses a part keeps every other sprite and destroys only the lost one', async () => {
    const s = await scene(SLAB);
    s.sync();
    const before = sprites(s.layer);
    const root = s.views.get(1)?.root;
    s.lose(1, 'frame@3,2');
    s.w.step();
    s.sync();
    const after = sprites(s.layer);
    expect(s.views.get(1)?.root).toBe(root);
    expect(after.size).toBe(before.size - 1);
    expect([...after].every((x) => before.has(x))).toBe(true);
    const lost = [...before].filter((x) => !after.has(x));
    expect(lost.map((x) => x.destroyed)).toEqual([true]);
    expectFresh(s);
    s.w.dispose();
  });

  it('keeps drawing right as a robot loses parts one by one, its first part and core among them', async () => {
    const s = await scene(SLAB);
    s.sync();
    let seed = 7;
    const ids = [...(s.w.robotById(1)?.parts.keys() ?? [])];
    // The core's piece keeps the id; its body's origin moves when its first part goes.
    const order = ['frame@0,3', ...ids.filter((id) => id !== 'frame@0,3')];
    for (let i = 0; i < 14; i++) {
      const before = sprites(s.layer);
      const id = i === 0 ? (order[0] as string) : (order.splice(1 + (seed = (seed * 31 + 11) % 97) % (order.length - 1), 1)[0] as string);
      const owner = s.w.robots.find((r) => r.parts.has(id));
      if (owner) s.lose(owner.id, id);
      s.w.step();
      s.sync();
      for (const x of sprites(s.layer)) expect(before.has(x)).toBe(true);
      expectFresh(s);
    }
    s.w.dispose();
  });

  it('a piece that breaks off takes its sprites to its own view, the bigger side keeping the container', async () => {
    const s = await scene({ format: 1, name: 'bar', grid: ['C F F F F F F F'] });
    s.sync();
    const before = sprites(s.layer);
    const body = s.views.get(1)?.root.children[0];
    s.lose(1, 'frame@2,0');
    s.w.step();
    s.sync();
    expect(s.w.robots).toHaveLength(2);
    const piece = s.views.get(2) as RobotView;
    // Five frames break off and two parts stay: the five keep the old container.
    expect(piece.root.children[0]).toBe(body);
    expect(sprites(piece.root).size).toBe(5);
    expect(sprites(s.layer).size).toBe(before.size - 1);
    for (const x of sprites(s.layer)) expect(before.has(x)).toBe(true);
    expectFresh(s);
    s.w.dispose();
  });

  it('a piece of a piece made between two syncs still finds its sprites', async () => {
    const s = await scene({ format: 1, name: 'bar', grid: ['C F F F F F F F F F'] });
    s.sync();
    const before = sprites(s.layer);
    s.lose(1, 'frame@2,0');
    s.w.step();
    const piece = s.w.robots[1] as Robot;
    s.lose(piece.id, 'frame@6,0');
    s.w.step();
    s.sync();
    expect(s.w.robots).toHaveLength(3);
    expect(sprites(s.layer).size).toBe(before.size - 2);
    for (const x of sprites(s.layer)) expect(before.has(x)).toBe(true);
    expectFresh(s);
    s.w.dispose();
  });

  it('joints: a turret, its mount and its wheels, through losses that change bodies and their order', async () => {
    const s = await scene({ format: 1, name: 'turret-car', grid: ['F . F F', 'R . F .', 'C B F F', 'W . . W'] }, { x: 0, y: 1.5 });
    s.w.step([{ robot: 1, pressed: ['d'], released: [] }]);
    for (let i = 0; i < 20; i++) s.w.step();
    s.sync();
    expectFresh(s);
    for (const id of ['frame@3,3', 'frame@0,3', 'frame@2,3', 'wheel@0,0', 'frame@3,1', 'rotator@0,2']) {
      const before = sprites(s.layer);
      const owner = s.w.robots.find((r) => r.parts.has(id)) as Robot;
      s.lose(owner.id, id);
      s.w.step();
      for (let i = 0; i < 3; i++) s.w.step();
      s.sync();
      expectFresh(s);
      // Only joint mounts are drawn again.
      const fresh = [...sprites(s.layer)].filter((x) => !before.has(x));
      expect(fresh.every((x) => x.texture.label?.endsWith('.mount'))).toBe(true);
    }
    s.w.dispose();
  });

  it('a piston rod, flames and a propeller move with their parts when a piece breaks off', async () => {
    const s = await scene({ format: 1, name: 'mix', grid: ['.  .  .  F  .  .  .', '.  .  .  I^ .  .  .', 'P  T^ B  C  B  T^ P'] });
    for (let i = 0; i < 5; i++) s.w.step();
    s.sync();
    expectFresh(s);
    s.lose(1, 'battery@2,0');
    s.w.step();
    s.sync();
    expect(s.w.robots).toHaveLength(2);
    expectFresh(s);
    s.lose(1, 'battery@4,0');
    s.lose(1, 'frame@3,2');
    s.w.step();
    s.sync();
    expectFresh(s);
    s.w.dispose();
  });

  it('a robot that grows parts (M12) draws them and its bay, and the copy it lets go takes its sprites', async () => {
    const bayBot = {
      format: 1,
      name: 'bay bot',
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'densebattery', x: -1, y: 0 },
        { part: 'densebattery', x: 1, y: 0 },
        { part: 'frame', x: 2, y: 0 },
        { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
      ],
      recipes: { item: { format: 1, name: 'post', grid: ['F', 'F', 'C'] } },
      bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
    };
    const s = await scene(bayBot, { x: 0, y: 0.5 });
    s.sync();
    expectFresh(s);
    let ticks = 0;
    while ((s.w.robotById(1)?.parts.size ?? 0) <= 5 && ticks++ < 900) {
      s.w.step();
      if (ticks % 50 === 0) s.sync();
    }
    s.sync();
    expect(s.w.robotById(1)?.parts.size).toBe(8);
    expectFresh(s);
    const before = sprites(s.layer);
    s.w.step([{ robot: 1, pressed: ['r'], released: [] }]);
    for (let i = 0; i < 3; i++) s.w.step();
    s.sync();
    expect(s.w.robots).toHaveLength(2);
    expectFresh(s);
    expect(sprites(s.views.get(2)?.root as Container).size).toBe(3);
    for (const x of sprites(s.views.get(2)?.root as Container)) expect(before.has(x)).toBe(true);
    s.w.dispose();
  });

  it('a robot removed loses its view, and nothing of it stays on the layer', async () => {
    const s = await scene({ format: 1, name: 'bar', grid: ['C F F F F F F F'] });
    s.sync();
    s.lose(1, 'frame@2,0');
    s.w.step();
    s.sync();
    const all = sprites(s.layer);
    s.w.removeRobots([1, 2]);
    s.w.step();
    s.sync();
    expect(s.views.size).toBe(0);
    expect(s.layer.children).toHaveLength(0);
    expect([...all].every((x) => x.destroyed)).toBe(true);
    s.w.dispose();
  });
});
