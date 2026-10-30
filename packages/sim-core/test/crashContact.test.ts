import { beforeAll, describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { loadRapier } from '../src/physics/rapier';
import { PhysicsWorld, type ContactImpulse } from '../src/physics/PhysicsWorld';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { CRASH_SAFE, contactWork, crashFelt, crashFraction, crashLoad, crashMass } from '../src/world/crash';
import { parsePartDef } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import type { Robot } from '../src/world/Robot';

beforeAll(async () => {
  await loadRapier();
});

const flat = parseWorldFile(flatJson);
const space = parseWorldFile({ name: 'space', ground: { width: 400, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const slab = (cols: number, rows: number, fill = 'F', special: Record<string, string> = {}): string[] => {
  const grid: string[] = [];
  for (let y = rows - 1; y >= 0; y--) grid.push(Array.from({ length: cols }, (_, x) => (special[`${x},${y}`] ?? fill).padEnd(3)).join(''));
  return grid;
};
// The health left of a robot and every piece that broke off it (pieces keep its name), over what it started with.
const healthShare = (w: World, r: Robot, full: number): number => {
  let left = 0;
  for (const x of w.robots) if (x.name === r.name) for (const p of x.parts.values()) left += Math.max(0, p.health);
  return left / full;
};
const fullHealth = (r: Robot): number => [...r.parts.values()].reduce((sum, p) => sum + p.def.health, 0);

describe('crash by contact: the pure parts', () => {
  it('a contact does work when it stops a closing speed, none on a resting load or a perfect bounce', () => {
    // 10 N s on side 2 along +x; side 1 closing at 4 m/s then stopped: 10 * 4 / 2.
    expect(contactWork(10, 0, 4, 0, 0, 0)).toBe(20);
    expect(contactWork(10, 0, 0, 0, 0, 0)).toBe(0);
    expect(contactWork(10, 0, 4, 0, -4, 0)).toBe(0);
    // Pushing apart (the solver separating overlapping parts) puts energy in.
    expect(contactWork(10, 0, -1, 0, -2, 0)).toBeLessThan(0);
  });

  it('an interface takes energy by its push squared times its softness, and pushes that cancel do not count', () => {
    expect(crashLoad(3, 4, 5, 5)).toBe(25);
    expect(crashLoad(3, 4, 5, 10)).toBe(50);
    expect(crashLoad(0, 0, 10, 10)).toBe(0);
    expect(crashLoad(0, 0, 0, 0)).toBe(0);
  });

  it('a body feels its share over its own mass, more when its joints pushed it into the hit', () => {
    // A body stopped dead against terrain feels the speed it hit at.
    expect(crashFelt(0.5 * 7 * 20 * 20, 7)).toBeCloseTo(20);
    expect(crashFelt(0, 7)).toBe(0);
    // A 1.5 kg wheel stopping a 7 kg car: the hit was 7 * 20 N s, the wheel's own momentum change only 1.5 * 20.
    expect(crashMass(1.5, 7, -140, 0, -30, 0)).toBeCloseTo(7);
    // A free arm: nothing pushed it, so its own mass.
    expect(crashMass(1.5, 200, -30, 0, -30, 0)).toBe(1.5);
    // Never past the robot's mass, never under the body's.
    expect(crashMass(1.5, 7, -140, 0, 0, 0)).toBe(7);
    expect(crashMass(1.5, 7, -10, 0, -30, 0)).toBe(1.5);
  });

  it('crash.hardness is a positive finite number, and a crash block may give only it', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('frame'))) as Record<string, unknown>;
    expect(parsePartDef(raw, 'f.json').crash).toEqual({ safe: 24, hardness: 2 });
    expect(parsePartDef({ ...raw, crash: { hardness: 3 } }, 'f.json').crash).toEqual({ hardness: 3 });
    for (const bad of [0, -1, Number.NaN, Infinity, -Infinity, 1e-308, 1e308, '2', null]) expect(() => parsePartDef({ ...raw, crash: { hardness: bad } }, 'f.json')).toThrow('crash.hardness must be a positive finite number');
    // A block with only hardness (or only range) keeps the other defaults; the sim reads them so.
    expect(parsePartDef({ ...raw, crash: { hardness: 1000 } }, 'f.json').crash).toEqual({ hardness: 1000 });
    expect(parsePartDef({ ...raw, crash: { range: 4 } }, 'f.json').crash).toEqual({ range: 4 });
    expect(crashFraction(13, { hardness: 3 })).toBeCloseTo(crashFraction(13, undefined));
    expect(crashFraction(CRASH_SAFE, { hardness: 3 })).toBe(0);
    expect(() => parsePartDef({ ...raw, crash: {} }, 'f.json')).toThrow('needs at least one of');
    expect(() => parsePartDef({ ...raw, crash: { soft: 1 } }, 'f.json')).toThrow('not a known field');
  });
});

describe('crash by contact: contact impulses', () => {
  // Every outside contact's impulse on a body, summed, against its momentum change (gravity aside), componentwise.
  const onBody = (contacts: ContactImpulse[], body: number): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    for (const c of contacts) {
      if (c.body1 === body) {
        x -= c.jx;
        y -= c.jy;
      }
      if (c.body2 === body) {
        x += c.jx;
        y += c.jy;
      }
    }
    return { x, y };
  };

  for (const order of ['ground first', 'box first'] as const) {
    it(`a box skidding on fixed ground: normal and friction both come out with their signs (${order})`, () => {
      const pw = new PhysicsWorld(-9.81, 1 / 60);
      let box = 0;
      const makeBox = (): void => {
        box = pw.createBody({ x: 0, y: 0.5, kind: 'dynamic' });
        pw.addCollider(box, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 10, friction: 0.5 }, 'b');
      };
      if (order === 'box first') makeBox();
      pw.createFixedBox(0, -0.5, 100, 1);
      if (order === 'ground first') makeBox();
      for (let i = 0; i < 30; i++) pw.step();
      pw.setVelocity(box, 20, -3, 0);
      pw.step();
      const s = pw.state(box);
      const p = pw.prevState(box);
      const j = onBody(pw.contactImpulses([box]), box);
      // Pushed up and back: friction against the slide.
      expect(j.x).toBeLessThan(-20);
      expect(j.y).toBeGreaterThan(40);
      expect(j.x).toBeCloseTo(10 * (s.vx - p.vx), 0);
      expect(j.y).toBeCloseTo(10 * (s.vy - p.vy + 9.81 / 60), 0);
      pw.free();
    });

    it(`two dynamic boxes skidding over each other: equal and opposite, each matching its momentum change (${order})`, () => {
      const pw = new PhysicsWorld(0, 1 / 60);
      let top = 0;
      let bottom = 0;
      const makeTop = (): void => {
        top = pw.createBody({ x: 0, y: 0.5, kind: 'dynamic' });
        pw.addCollider(top, { shape: 'box', hx: 0.5, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 10, friction: 0.5 }, 't');
      };
      const makeBottom = (): void => {
        bottom = pw.createBody({ x: 0, y: -0.5, kind: 'dynamic' });
        pw.addCollider(bottom, { shape: 'box', hx: 50, hy: 0.5 }, { offsetX: 0, offsetY: 0, mass: 1000 }, 'g');
      };
      if (order === 'box first') {
        makeTop();
        makeBottom();
      } else {
        makeBottom();
        makeTop();
      }
      pw.step();
      pw.setVelocity(top, 20, -3, 0);
      pw.step();
      for (const [ids, label] of [[[top], 'top'], [[bottom], 'bottom'], [[bottom, top], 'both']] as const) {
        const contacts = pw.contactImpulses(ids);
        expect(contacts, label).toHaveLength(1);
        const a = onBody(contacts, top);
        const b = onBody(contacts, bottom);
        expect(a.x + b.x).toBe(0);
        expect(a.y + b.y).toBe(0);
        const s = pw.state(top);
        const p = pw.prevState(top);
        expect(a.x).toBeLessThan(-20);
        expect(a.x).toBeCloseTo(10 * (s.vx - p.vx), 0);
        expect(a.y).toBeCloseTo(10 * (s.vy - p.vy), 0);
      }
      pw.free();
    });
  }

  it('a hit in the first substep of a kick step counts once: the impulses read after it match the momentum change', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const slabBot = w.spawnBlueprint({ format: 1, name: 'slab', grid: slab(5, 3, 'F', { '2,1': 'C' }) }, { x: 0, y: 40 });
    const car = w.spawnBlueprint({ format: 1, name: 'car', grid: ['F  F  F  C  F', 'W  .  .  .  W'] }, { x: 4.6, y: 40 });
    w.step();
    // A kick (the slab's own, here) splits the next physics step in two (`PhysicsWorld.applyKicks`). Slow enough that
    // nothing breaks: a part lost on the hit would rebuild the car before the impulses are read here.
    w.kickRobot(slabBot, 30, 0);
    w.step();
    const body = slabBot.groups[0]?.bodyId ?? -1;
    const s = w.physics.state(body);
    const p = w.physics.prevState(body);
    const m = w.physics.massProperties(body).mass;
    const all = [...slabBot.groups, ...car.groups].map((g) => g.bodyId);
    const j = onBody(w.physics.contactImpulses(all).filter((c) => all.includes(c.body1) && all.includes(c.body2)), body);
    expect(m * (s.vx - p.vx)).toBeLessThan(-100);
    expect(Math.abs(j.x - m * (s.vx - p.vx))).toBeLessThan(0.02 * Math.abs(m * (s.vx - p.vx)));
    w.dispose();
  });
});

describe('crash by contact: what you hit matters', () => {
  const ARAM = { format: 1, name: 'armorram', grid: slab(6, 5, 'A', { '0,2': 'C' }) };
  const FBIG = { format: 1, name: 'frameblock', grid: slab(12, 12, 'F', { '11,6': 'C' }) };

  it('an armor ram into a frame block hurts the frames, not the ram', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const block = w.spawnBlueprint(FBIG, { x: 20, y: 34 }, { team: 1 });
    const ram = w.spawnBlueprint(ARAM, { x: -20, y: 37 });
    const full = [fullHealth(block), fullHealth(ram)] as const;
    w.kickRobot(ram, 40, 0);
    for (let i = 0; i < 90; i++) w.step();
    expect(healthShare(w, ram, full[1])).toBe(1);
    expect(healthShare(w, block, full[0])).toBeLessThan(0.9);
    w.dispose();
  });

  it('a target hit from both sides in the same step is crushed: the two pushes do not cancel', async () => {
    const w = await World.create({ seed: 1, gravityY: 0 }, space);
    const target = w.spawnBlueprint({ format: 1, name: 'target', grid: slab(5, 5, 'F', { '2,2': 'C' }) }, { x: 0, y: 37 }, { team: 1 });
    const left = w.spawnBlueprint(ARAM, { x: -20, y: 37 });
    const right = w.spawnBlueprint({ ...ARAM, name: 'armorram2', grid: slab(6, 5, 'A', { '5,2': 'C' }) }, { x: 16, y: 37 }, { team: 2 });
    const core = target.primaryCoreId ?? '';
    const full = fullHealth(left);
    w.kickRobot(left, 30, 0);
    w.kickRobot(right, -30, 0);
    for (let i = 0; i < 90; i++) w.step();
    expect(w.events.some((e) => e.kind === 'partDestroyed' && e.robot === target.id && e.part === core)).toBe(true);
    // The rams, plate against frame, take a scratch at most.
    expect(healthShare(w, left, full)).toBeGreaterThan(0.99);
    expect(healthShare(w, right, full)).toBeGreaterThan(0.99);
    w.dispose();
  });

  it('a 3.2 t slab set down resting on a light robot hurts nothing: a still load is not a hit', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const lift = w.spawnBlueprint({ format: 1, name: 'lift', grid: ['F  F  F  F  F  F  F', 'B  B  C  B  B  B  B'] }, { x: -100, y: 0.5 });
    // Its bottom face 5 cm over the robot's top (2 m): the slab's core is in its top row.
    w.spawnBlueprint({ format: 1, name: 'wideslab', grid: slab(40, 4, 'A', { '20,3': 'C' }) }, { x: -100, y: 5.55 });
    const full = fullHealth(lift);
    for (let i = 0; i < 240; i++) w.step();
    expect(healthShare(w, lift, full)).toBe(1);
    w.dispose();
  });

  it('a 1 t world box dropped 2.5 m onto a light robot on the ground crushes it (a dynamic box has mass)', async () => {
    const world = parseWorldFile({ name: 'crate', ground: { width: 2000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [{ x: -100, y: 5.5, w: 6, h: 2, dynamic: true, mass: 1000 }] });
    const w = await World.create({ seed: 1 }, world);
    const lift = w.spawnBlueprint({ format: 1, name: 'lift', grid: ['F  F  F  F  F  F  F', 'B  B  C  B  B  B  B'] }, { x: -100, y: 0.5 });
    const full = fullHealth(lift);
    for (let i = 0; i < 300; i++) w.step();
    expect(healthShare(w, lift, full)).toBeLessThan(0.9);
    w.dispose();
  });

  it('a light arm on a rotator is not shielded by its heavy base: hit at the tip, it feels about what the arm alone would', async () => {
    const MISSILE = { format: 1, name: 'missile', grid: ['B  B  C  B  X'], legend: { X: { part: 'warhead' } } };
    const ARM = Array.from({ length: 6 }, () => '.  .  .  F');
    const hit = async (grid: string[], at: { x: number; y: number }): Promise<number> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      const bot = w.spawnBlueprint({ format: 1, name: 'armbot', grid }, at, { team: 1 });
      const missile = w.spawnBlueprint(MISSILE, { x: -25, y: 37.6 });
      const full = fullHealth(bot);
      w.kickRobot(missile, 60, 0);
      for (let i = 0; i < 90; i++) w.step();
      const share = healthShare(w, bot, full);
      w.dispose();
      return share;
    };
    const base = ['A  A  A  A', 'A  C  A  A', 'A  A  A  A'];
    const onRotator = await hit([...ARM, '.  .  .  R', ...base], { x: 0, y: 30 });
    const welded = await hit([...ARM, '.  .  .  F', ...base], { x: 0, y: 30 });
    // Welded to 220 kg of plate, the arm is part of a heavy body and takes nothing; on its hinge it is hurt.
    expect(welded).toBe(1);
    expect(onRotator).toBeLessThan(1);
  });

  it('runs the same twice', async () => {
    const run = async (): Promise<string> => {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      w.spawnBlueprint(FBIG, { x: 20, y: 34 }, { team: 1 });
      const ram = w.spawnBlueprint(ARAM, { x: -20, y: 37 });
      w.kickRobot(ram, 40, 0);
      for (let i = 0; i < 90; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
