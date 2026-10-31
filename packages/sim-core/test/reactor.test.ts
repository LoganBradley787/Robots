import { describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { PartInstance, Robot } from '../src/world/Robot';
import { fillContainers, fillHeld } from '../src/resources/pools';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';
import { createQuickJsHost } from '../src/script/quickjs';
import { Controller } from '../src/control/controller';
import { validateBlueprint } from '../src/blueprint/validate';
import { staticStats } from '../src/blueprint/stats';

// No gravity and a ground far below, so a robot stays where it is put and only the energy moves.
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });
const FIRE = [{ key: 'f', mode: 'hold', target: 'laser', channel: 'fire', value: 1 }];

/** A small reactor (300 W) on a core (600 J). */
const SMALL = { format: 1, name: 'small', grid: ['C  rc'] };
/** A big reactor (1500 W) on a core, and a laser (2400 W) that fires on F. */
const BIG = {
  format: 1,
  name: 'big',
  grid: ['.   =   =   =   =', '.   Lz^ =   =   =', 'C   F   Rc  =   ='],
  bindings: FIRE,
};
/** A small reactor on a core and a laser. */
const SHOT = { format: 1, name: 'shot', grid: ['.  =', '.  Lz^', 'C  rc'], bindings: FIRE };
/** The same with two batteries and a dense battery on the piece. */
const FUSED = { format: 1, name: 'fused', grid: ['.  =  .', 'B  Lz^ .', 'C  rc  Z', 'B  .   .'], bindings: FIRE };
/** Two lasers and no batteries past the core. */
const TWIN = { format: 1, name: 'twin', grid: ['=   .  =', 'Lz^ .  Lz^', 'F   C  F', 'rc  .  .'], bindings: FIRE };

async function world(seed = 1): Promise<World> {
  return World.create({ seed, gravityY: 0 }, space);
}
function drain(r: Robot, to = 0): void {
  for (const p of r.parts.values()) if (p.stored !== undefined) p.stored = to;
}
function stored(r: Robot): number {
  let s = 0;
  for (const p of r.parts.values()) s += p.stored ?? 0;
  return s;
}
function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.step();
}
function ofType(r: Robot, type: string): PartInstance[] {
  return [...r.parts.values()].filter((p) => p.def.id === type);
}
function reactor(r: Robot): PartInstance {
  const p = [...r.parts.values()].find((q) => q.def.reactor !== undefined);
  if (!p) throw new Error('no reactor');
  return p;
}
function press(w: World, r: Robot, key = 'f'): void {
  w.step([{ robot: r.id, pressed: [key], released: [] }]);
}

describe('reactor parts', () => {
  it('are data: 15 W per kg, two sizes, in the registry, batteries are their fuses', () => {
    const reg = defaultRegistry();
    const big = reg.get('reactor');
    const small = reg.get('smallreactor');
    expect(big.reactor).toEqual({ power: 1500, cap: 3, tau: 10, burn: 40 });
    expect(small.reactor).toEqual({ power: 300, cap: 3, tau: 4, burn: 40 });
    expect(big.reactor!.power / big.mass).toBe(15);
    expect(small.reactor!.power / small.mass).toBe(15);
    expect(big.footprint.length).toBe(9);
    expect(reg.list().filter((d) => d.fuse === true).map((d) => d.id).sort()).toEqual(['battery', 'cell', 'densebattery']);
    expect(reg.get('core').fuse).toBeUndefined();
  });

  const def = (over: object): unknown => ({
    id: 'r',
    name: 'R',
    footprint: [{ x: 0, y: 0, faces: ['N'] }],
    mass: 1,
    health: 1,
    symmetry: 1,
    inputs: [{ name: 'push', min: 0, max: 3, default: 0, holds: true }],
    outputs: [
      { name: 'heat', min: 0, max: 1, default: 0 },
      { name: 'load', min: 0, max: 3, default: 0 },
    ],
    powerDraw: 0,
    sprite: { frame: 'x' },
    reactor: { power: 1, cap: 3, tau: 1, burn: 1 },
    ...over,
  });

  it('a bad reactor block says what is wrong', () => {
    expect(parsePartDef(def({}), 'r.json').reactor?.cap).toBe(3);
    expect(() => parsePartDef(def({ reactor: { power: 1, cap: 1, tau: 1, burn: 1 } }), 'r.json')).toThrow(/reactor\.cap must be above 1/);
    expect(() => parsePartDef(def({ reactor: { power: 0, cap: 3, tau: 1, burn: 1 } }), 'r.json')).toThrow(/reactor\.power must be greater than 0/);
    expect(() => parsePartDef(def({ reactor: { power: 1, cap: 3, tau: 1 } }), 'r.json')).toThrow(/reactor\.burn is required/);
    expect(() => parsePartDef(def({ inputs: [] }), 'r.json')).toThrow(/must have a "push" input/);
    expect(() => parsePartDef(def({ inputs: [{ name: 'push', min: 0, max: 2, default: 0 }] }), 'r.json')).toThrow(/from 0 to its cap \(3\)/);
    expect(() => parsePartDef(def({ outputs: [] }), 'r.json')).toThrow(/must have a "heat" output/);
    expect(() => parsePartDef(def({ fuse: false }), 'r.json')).toThrow(PartDefError);
    expect(() => parsePartDef(def({ outputs: [{ name: 'heat', min: 0, max: 1, default: 0, holds: true }] }), 'r.json')).toThrow(/is for inputs/);
  });

  it('static stats count steady power', () => {
    const bp = validateBlueprint(BIG, defaultRegistry()).blueprint!;
    expect(staticStats(bp, defaultRegistry()).power).toBe(1500);
    expect(staticStats(bp, defaultRegistry()).massKg).toBeCloseTo(2 + 1 + 4 + 100, 6);
  });

  it('fillHeld matches fillContainers', () => {
    const mk = (a: number): { stored: number; def: { resource: { capacity: number } } }[] => [
      { stored: a, def: { resource: { capacity: 100 } } },
      { stored: 3, def: { resource: { capacity: 10 } } },
      { stored: 0.1, def: { resource: { capacity: 1000 } } },
    ];
    for (const amount of [0, 0.5, 7, 1000, 5000]) {
      const held = mk(40);
      const boxes = mk(40).map((h, i) => ({ id: `${i}`, stored: h.stored, capacity: h.def.resource.capacity }));
      expect(fillHeld(held, amount)).toBe(fillContainers(boxes, amount));
      expect(held.map((h) => h.stored)).toEqual(boxes.map((b) => b.stored));
    }
  });
});

describe('reactor: steady output', () => {
  it('fills up to capacity, then makes nothing', async () => {
    const w = await world();
    const r = w.spawnBlueprint(SMALL, { x: 0, y: 100 });
    drain(r);
    run(w, 60);
    expect(stored(r)).toBeCloseTo(300, 6);
    expect(reactor(r).load).toBeCloseTo(1, 9);
    run(w, 90);
    expect(stored(r)).toBe(600);
    run(w, 5);
    expect(reactor(r).load).toBe(0);
    expect(reactor(r).heat).toBe(0);
    w.dispose();
  });

  it('a spike drains the pool, and it refills once the spike is over', async () => {
    const w = await world();
    const r = w.spawnBlueprint(SHOT, { x: 0, y: 100 });
    press(w, r);
    run(w, 14);
    expect(stored(r)).toBeLessThan(600 - 2100 * 0.2);
    w.step([{ robot: r.id, pressed: [], released: ['f'] }]);
    const low = stored(r);
    run(w, 120);
    expect(stored(r)).toBeCloseTo(Math.min(600, low + 600), 6);
    expect(reactor(r).heat).toBe(0);
    w.dispose();
  });

  it('runs with no core in charge: a wreck has its reactor', async () => {
    const w = await world();
    const r = w.spawnBlueprint({ format: 1, name: 'headless', grid: ['rc B'] }, { x: 0, y: 100 });
    drain(r);
    expect(w.canControl(r.id)).toBe(false);
    run(w, 60);
    expect(stored(r)).toBeCloseTo(300, 6);
    w.dispose();
  });

  it('keeps running on a piece whose core was destroyed', async () => {
    const w = await world();
    const r = w.spawnBlueprint({ format: 1, name: 'piece', grid: ['C  B  rc'] }, { x: 0, y: 100 });
    w.step();
    const core = ofType(r, 'core')[0]!;
    core.health = 0;
    w.step();
    expect(w.canControl(r.id)).toBe(false);
    drain(r);
    run(w, 60);
    expect(stored(r)).toBeCloseTo(300, 6);
    w.dispose();
  });

  it('a piece keeps only the reactors it holds', async () => {
    const w = await world();
    const r = w.spawnBlueprint({ format: 1, name: 'twins', grid: ['C  B  F  B  rc'] }, { x: 0, y: 100 });
    w.step();
    ofType(r, 'frame')[0]!.health = 0;
    w.step();
    const pieces = w.robots;
    expect(pieces.length).toBe(2);
    for (const p of pieces) drain(p);
    run(w, 60);
    const withReactor = pieces.find((p) => ofType(p, 'smallreactor').length === 1)!;
    const without = pieces.find((p) => p !== withReactor)!;
    expect(stored(withReactor)).toBeCloseTo(300, 6);
    expect(stored(without)).toBe(0);
    w.dispose();
  });

  it('does nothing under Unlimited energy, and cools', async () => {
    const w = await world();
    const r = w.spawnBlueprint(SMALL, { x: 0, y: 100 });
    drain(r);
    reactor(r).heat = 0.5;
    w.setUnlimitedEnergy(true);
    run(w, 60);
    expect(stored(r)).toBe(0);
    expect(reactor(r).load).toBe(0);
    expect(reactor(r).heat).toBeCloseTo(0.5 * (1 - 1 / 240) ** 60, 9);
    w.dispose();
  });

  it('powered: something stored, or a reactor making something', async () => {
    const w = await world();
    const shot = w.spawnBlueprint(SHOT, { x: 0, y: 100 });
    const plain = w.spawnBlueprint({ format: 1, name: 'plain', grid: ['C'] }, { x: 20, y: 100 });
    drain(plain);
    expect(w.powered(plain.id)).toBe(false);
    drain(shot);
    press(w, shot);
    run(w, 5);
    // The laser takes all it makes: the pool ends the tick at 0, and the reactor is still running.
    expect(stored(shot)).toBe(0);
    expect(w.powered(shot.id)).toBe(true);
    w.dispose();
  });
});

describe('reactor: overdrive and heat', () => {
  it('no heat while the pool pays, however far over rating the draw is', async () => {
    const w = await world();
    const r = w.spawnBlueprint(BIG, { x: 0, y: 100 });
    const big = reactor(r);
    w.step();
    for (const p of r.parts.values()) if (p.stored !== undefined) p.stored = 600;
    press(w, r);
    run(w, 30);
    expect(stored(r)).toBeGreaterThan(0);
    expect(big.heat).toBe(0);
    expect(big.load).toBeLessThanOrEqual(1);
    w.dispose();
  });

  it('on an empty pool it makes the shortfall: load is demand over rating, and the draw is granted in full', async () => {
    const w = await world();
    const r = w.spawnBlueprint(BIG, { x: 0, y: 100 });
    drain(r);
    press(w, r);
    run(w, 10);
    expect(reactor(r).load).toBeCloseTo(2400 / 1500, 9);
    expect(ofType(r, 'laser')[0]!.beam).toBe(1);
    expect(stored(r)).toBe(0);
    w.dispose();
  });

  it('stops at the cap and the rest browns out in proportion', async () => {
    const w = await world();
    const r = w.spawnBlueprint(SHOT, { x: 0, y: 100 });
    drain(r);
    press(w, r);
    run(w, 10);
    expect(reactor(r).load).toBeCloseTo(3, 9);
    expect(ofType(r, 'laser')[0]!.beam).toBeCloseTo(900 / 2400, 9);
    w.dispose();
  });

  it('heat climbs to over squared with tau, and falls the same way', async () => {
    const w = await world();
    const r = w.spawnBlueprint(BIG, { x: 0, y: 100 });
    const big = reactor(r);
    // Past 1.6 times rating: over is 0.3, the target is 0.09.
    drain(r);
    // The laser is what draws the most, and nothing else stands between it and the heat.
    ofType(r, 'laser')[0]!.health = 1e9;
    press(w, r);
    run(w, 599);
    const target = 0.09;
    expect(big.heat).toBeCloseTo(target * (1 - (1 - 1 / 600) ** 600), 6);
    run(w, 6000);
    expect(big.heat).toBeCloseTo(target, 3);
    const hot = big.heat ?? 0;
    w.step([{ robot: r.id, pressed: [], released: ['f'] }]);
    run(w, 599);
    expect(big.heat).toBeCloseTo(hot * (1 - 1 / 600) ** 600, 6);
    run(w, 60 * 200);
    expect(big.heat).toBe(0);
    w.dispose();
  });

  it('at rating it stays at rating: a sum of shares that rounds up is no overload, and a hot reactor at rating fries nothing', async () => {
    const w = await world();
    const bp = { format: 1, name: 'many', grid: ['Z  E  B  C  rc  Z  E  B', 'E  Z  Z  B  E   B  Z  E'] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
    let i = 0.17;
    for (const p of r.parts.values()) if (p.stored !== undefined) p.stored = (p.def.resource?.capacity ?? 0) * (i = (i * 7.3) % 0.9);
    reactor(r).heat = 0.5;
    run(w, 600);
    expect(w.events.filter((e) => e.kind === 'overload')).toEqual([]);
    expect(reactor(r).load).toBe(1);
    expect(w.events.filter((e) => e.kind === 'partDestroyed')).toEqual([]);
    for (const p of r.parts.values()) if (p.def.fuse === true) expect(p.health).toBe(p.def.health);
    w.dispose();
  });

  it('a little over rating still heats a little: no line to stop just short of', async () => {
    const w = await world();
    const bp = { format: 1, name: 'trickle', grid: ['C  rc  Z'], bindings: [{ key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value: 1.01 }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
    drain(r);
    press(w, r, 'p');
    expect(reactor(r).load).toBeCloseTo(1.01, 9);
    // One tick's heat from cold is far under what snaps a cooling reactor to 0.
    expect(reactor(r).heat).toBeGreaterThan(0);
    expect(reactor(r).heat).toBeLessThan(1e-6);
    w.dispose();
  });

  it('a chunk rebuilt mid-tick has no overdrive for the rest of that tick, the same every run', async () => {
    const bp = { format: 1, name: 'split', grid: ['.  =', '.  Lz^', 'C  rc', 'D  .', 'F  .'], bindings: [...FIRE, { key: 'g', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] };
    const runOnce = async (): Promise<string> => {
      const w = await world();
      const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
      drain(r);
      press(w, r);
      run(w, 20);
      w.step([{ robot: r.id, pressed: ['g'], released: ['g'] }]);
      run(w, 20);
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await runOnce()).toBe(await runOnce());
  });

  it('the same seed gives the same hash, and heat is in it', async () => {
    const go = async (heat: number): Promise<string> => {
      const w = await world(7);
      const r = w.spawnBlueprint(FUSED, { x: 0, y: 100 });
      drain(r);
      reactor(r).heat = heat;
      press(w, r);
      run(w, 240);
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await go(0)).toBe(await go(0));
    expect(await go(0)).not.toBe(await go(0.5));
  });

  it('a stock robot hashes no heat: reactors add nothing to a robot without one', async () => {
    const w = await world();
    const r = w.spawnBlueprint({ format: 1, name: 'plain', grid: ['C  B'] }, { x: 0, y: 100 });
    run(w, 5);
    const before = w.hash();
    const again = await world();
    again.spawnBlueprint({ format: 1, name: 'plain', grid: ['C  B'] }, { x: 0, y: 100 });
    run(again, 5);
    for (const p of r.parts.values()) p.heat = 0.5;
    expect(w.hash()).toBe(before);
    expect(again.hash()).toBe(before);
    w.dispose();
    again.dispose();
  });
});

describe('reactor: push', () => {
  it('holds a script write until changed', () => {
    const c = new Controller([], [{ id: 'r', part: 'reactor', tags: ['r'], inputs: [{ name: 'push', min: 0, max: 3, default: 0, holds: true }, { name: 'plain', min: 0, max: 3, default: 0 }] }]);
    c.scriptWrite('r', 'push', 2);
    c.scriptWrite('r', 'plain', 2);
    expect(c.values().get('r')?.get('push')).toBe(2);
    expect(c.values().get('r')?.get('plain')).toBe(2);
    c.endTick();
    expect(c.values().get('r')?.get('push')).toBe(2);
    expect(c.values().get('r')?.get('plain')).toBe(0);
    c.endTick();
    c.scriptWrite('r', 'push', 0);
    expect(c.values().get('r')?.get('push')).toBe(0);
    c.endTick();
    expect(c.values().get('r')?.get('push')).toBe(0);
  });

  it('carries to a grown robot, and a key beats it only while active', () => {
    const inputs = [{ name: 'push', min: 0, max: 3, default: 0, holds: true }];
    const bind = [{ key: 'p', mode: 'hold' as const, target: 'r', channel: 'push', value: 3 }];
    const c = new Controller(bind, [{ id: 'r', part: 'reactor', tags: ['r'], inputs }]);
    c.scriptWrite('r', 'push', 1.5);
    c.endTick();
    c.endTick();
    const grown = new Controller(bind, [{ id: 'r', part: 'reactor', tags: ['r'], inputs }]);
    grown.carryFrom(c);
    expect(grown.values().get('r')?.get('push')).toBe(1.5);
    grown.apply(['p'], []);
    expect(grown.values().get('r')?.get('push')).toBe(3);
    grown.endTick();
    grown.apply([], ['p']);
    grown.endTick();
    expect(grown.values().get('r')?.get('push')).toBe(1.5);
  });

  it('runs at x times rating with charge left, and fills the pool that much faster', async () => {
    const w = await world();
    const bp = { format: 1, name: 'pushed', grid: ['C  rc  Z'], bindings: [{ key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value: 2 }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
    drain(r, 100);
    press(w, r, 'p');
    run(w, 59);
    expect(stored(r)).toBeCloseTo(200 + 600, 3);
    expect(reactor(r).load).toBeCloseTo(2, 9);
    expect(reactor(r).heat).toBeGreaterThan(0);
    w.dispose();
  });

  it('heats and fries a battery with charge left, weakest first', async () => {
    const w = await world();
    const bp = { format: 1, name: 'pushed', grid: ['B  C  rc  Z'], bindings: [{ key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value: 3 }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
    drain(r, 100);
    press(w, r, 'p');
    while (w.tick < 60 * 30 && ofType(r, 'densebattery').length + ofType(r, 'battery').length === 2) w.step();
    const lost = w.events.find((e) => e.kind === 'partDestroyed');
    expect(lost).toMatchObject({ cooked: true, exploded: false });
    expect(stored(r)).toBeGreaterThan(0);
    w.dispose();
  });

  it('on a full pool a pushed reactor makes what the pool can take and stays cold', async () => {
    const w = await world();
    const bp = { format: 1, name: 'pushed', grid: ['C  rc  Z'], bindings: [{ key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value: 3 }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
    press(w, r, 'p');
    run(w, 60);
    expect(reactor(r).load).toBe(0);
    expect(reactor(r).heat).toBe(0);
    w.dispose();
  });

  it('under 1 it keeps the reactor to its rating, and at 2 it stops at 2', async () => {
    for (const [value, load] of [
      [0.5, 1],
      [1, 1],
      [2, 2],
    ] as const) {
      const w = await world();
      const bp = { ...SHOT, bindings: [...FIRE, { key: 'p', mode: 'toggle', target: 'smallreactor', channel: 'push', value }] };
      const r = w.spawnBlueprint(bp, { x: 0, y: 100 });
      drain(r);
      w.step([{ robot: r.id, pressed: ['f', 'p'], released: [] }]);
      run(w, 10);
      expect(reactor(r).load).toBeCloseTo(load, 9);
      expect(ofType(r, 'laser')[0]!.beam).toBeCloseTo((300 * load) / 2400, 9);
      if (value <= 1) expect(reactor(r).heat).toBe(0);
      w.dispose();
    }
  });

  it('a script sets it once and it holds; the part reads push, heat and load', async () => {
    const scripts = await createQuickJsHost(variant);
    const w = await World.create({ seed: 1, gravityY: 0, scripts }, space);
    const source = `
      let done = false;
      function tick() {
        if (!done) { set('r1', 'push', 2); done = true; }
        const r = parts.find((p) => p.type === 'reactor');
        log(r.in.push + ' ' + r.spec.reactor.power + ' ' + typeof r.out.heat + ' ' + get('r1', 'load') + ' ' + r.spec.in.push.max);
      }`;
    const r = w.spawnBlueprint({ format: 1, name: 'pushed', grid: ['.  =  =  =', '.  =  =  =', 'C  R1 =  ='], legend: { R1: { part: 'reactor', tags: ['r1'] } }, scripts: [{ id: 'once', enabled: true, source }] }, { x: 0, y: 100 });
    drain(r);
    run(w, 5);
    expect(reactor(r).load).toBeCloseTo(2, 9);
    expect(w.scriptLogs.at(-1)?.text).toBe('2 1500 number 2 3');
    w.dispose();
  });
});

describe('reactor: who fries', () => {
  it('the weakest fuse first, then it sticks; the rest spills over', async () => {
    const w = await world();
    const r = w.spawnBlueprint(FUSED, { x: 0, y: 100 });
    drain(r);
    const [first, second] = ofType(r, 'battery');
    second!.health = 5;
    reactor(r).heat = 1;
    press(w, r);
    run(w, 3);
    expect(second!.health).toBeLessThan(5);
    expect(first!.health).toBe(30);
    expect(ofType(r, 'densebattery')[0]!.health).toBe(30);
    w.dispose();
  });

  it('a big burn in one tick spills into the next victim', async () => {
    const w = await world();
    const r = w.spawnBlueprint(FUSED, { x: 0, y: 100 });
    drain(r);
    const [a, b] = ofType(r, 'battery');
    a!.health = 0.1;
    b!.health = 0.1;
    reactor(r).heat = 1;
    press(w, r);
    run(w, 2);
    expect(ofType(r, 'battery').length).toBe(0);
    const cooked = w.events.filter((e) => e.kind === 'partDestroyed' && e.cooked === true);
    expect(cooked.length).toBe(2);
    expect(w.events.filter((e) => e.kind === 'overload').length).toBe(1);
    w.dispose();
  });

  it('with no fuses, the top drawer, and a laser that fries goes off', async () => {
    const w = await world();
    const r = w.spawnBlueprint(TWIN, { x: 0, y: 100 });
    drain(r);
    reactor(r).heat = 1;
    const lasers = ofType(r, 'laser');
    lasers[1]!.health = 2;
    press(w, r);
    run(w, 2);
    expect(lasers[0]!.health).toBe(40);
    expect(lasers[1]!.health).toBeLessThan(2);
    run(w, 3);
    expect(ofType(r, 'laser').length).toBe(1);
    expect(w.events.find((e) => e.kind === 'partDestroyed' && e.partType === 'laser')).toMatchObject({ cooked: true, exploded: true });
    w.dispose();
  });

  it('the core and the reactor are never picked; with nothing drawing, nothing fries', async () => {
    const w = await world();
    const r = w.spawnBlueprint(SMALL, { x: 0, y: 100 });
    drain(r);
    reactor(r).heat = 1;
    const coreHealth = ofType(r, 'core')[0]!.health;
    const hp = reactor(r).health;
    // Past rating with no fuse and nothing asking: a pushed fill.
    run(w, 60);
    expect(ofType(r, 'core')[0]!.health).toBe(coreHealth);
    expect(reactor(r).health).toBe(hp);
    w.dispose();
  });

  it('counts a bay in the early pass as a drawer', async () => {
    const w = await world();
    const bay = {
      format: 1,
      name: 'bay',
      grid: ['=  .  =', '=  .  =', '=  .  =', '=  .  =', '=  .  =', '=  Bb =', '.  C  .', '.  rc .'],
      legend: { Bb: { part: 'fabbay', tags: ['bay'], makes: 'pod' } },
      recipes: { pod: { format: 1, name: 'pod', grid: ['C', 'F'] } },
    };
    const v = validateBlueprint(bay, w.registry);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const r = w.spawnBlueprint(bay, { x: 0, y: 100 });
    drain(r);
    reactor(r).heat = 1;
    const fab = ofType(r, 'fabbay')[0]!;
    run(w, 30);
    // 400 W against a 300 W reactor: past rating, and the bay is all that draws.
    expect(reactor(r).load).toBeGreaterThan(1);
    expect(fab.health).toBeLessThan(150);
    w.dispose();
  });

  it('exact ties go by the seeded RNG, the same every run', async () => {
    const go = async (seed: number): Promise<string> => {
      const w = await world(seed);
      const r = w.spawnBlueprint(FUSED, { x: 0, y: 100 });
      drain(r);
      reactor(r).heat = 1;
      press(w, r);
      run(w, 120);
      const picks = ofType(r, 'battery').map((p) => `${p.id}:${p.health}`).join();
      w.dispose();
      return picks;
    };
    expect(await go(3)).toBe(await go(3));
  });
});
