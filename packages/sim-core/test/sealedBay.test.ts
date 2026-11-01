import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { PartInstance, Robot } from '../src/world/Robot';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { resolveScripts } from '../src/blueprint/scripts';

// No gravity, so a robot stays where it is put and only the energy moves.
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });
const BAY = 'fabbay@0,1';
const RELEASE = { key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 };
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** A copy of a core, two dense batteries and whatever else. */
const copy = (...rest: Record<string, unknown>[]): Record<string, unknown> => ({
  format: 1,
  name: 'copy',
  parts: [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: 0, y: 1 }, { part: 'densebattery', x: 0, y: 2 }, ...rest],
});
/** A base with a bay on top, three dense batteries (it pays for the copy's charge), a thruster on T that drains them, whatever else `extra` adds. */
const carrier = (recipe: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const { parts = [], bindings = [], ...rest } = extra as { parts?: unknown[]; bindings?: unknown[] };
  return {
    format: 1,
    name: 'carrier',
    parts: [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: -1, y: 0 }, { part: 'densebattery', x: -2, y: 0 }, { part: 'densebattery', x: -3, y: 0 }, { part: 'thruster', x: 1, y: 0, tags: ['jet'] }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }, ...parts],
    recipes: { item: recipe },
    bindings: [RELEASE, { key: 't', mode: 'hold', target: 'jet', channel: 'throttle', value: 1 }, ...bindings],
    ...rest,
  };
};
const world = (seed = 1, scripts?: ScriptHost): Promise<World> => World.create({ seed, gravityY: 0, ...(scripts ? { scripts } : {}) }, space);
const run = (w: World, ticks: number): void => {
  for (let i = 0; i < ticks; i++) w.step();
};
const built = (w: World): number => w.events.filter((e) => e.kind === 'built').length;
/** Steps until the first copy is built. */
function untilBuilt(w: World): void {
  for (let i = 0; i < 2000 && built(w) === 0; i++) w.step();
  expect(built(w)).toBe(1);
}
const held = (r: Robot): PartInstance[] => [...r.parts.values()].filter((p) => p.tags[0] === 'bay1');
const charge = (parts: Iterable<PartInstance>): number => [...parts].reduce((s, p) => s + (p.stored ?? 0), 0);
const release = (w: World, r: Robot): void => w.step([{ robot: r.id, pressed: ['r'], released: [] }]);
const FULL = 12600;

describe('sealed bays: what a bay holds stays out of its carrier', () => {
  it('a finished copy adds nothing to the pool or its capacity, in any reading', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy()), { x: 0, y: 100 });
    const cap = w.energy(r.id)?.capacity;
    const before = w.energy(r.id)?.stored ?? 0;
    untilBuilt(w);
    const job = 8 * 40 + FULL;
    expect(w.energy(r.id)?.capacity).toBe(cap);
    expect(w.energy(r.id)?.stored).toBeCloseTo(before - job, 3);
    expect(w.partOutput(r.id, 'core@0,0', 'energyCapacity')).toBe(cap);
    expect(charge(held(r))).toBe(FULL);
    // Its own container still reads its own charge.
    expect(w.partOutput(r.id, held(r).find((p) => p.def.id === 'densebattery')?.id ?? '', 'charge')).toBe(1);
    w.dispose();
  });

  it('a script reads the carrier alone, both the first frame after a build and later', async () => {
    const w = await world(1, host);
    const script = { id: 'read', enabled: true, source: 'function tick() { if (get("bay", "ready") > 0) log(self.energy.capacity + " " + parts.find((p) => p.type === "core").out.energyCapacity); }' };
    const r = w.spawnBlueprint(carrier(copy(), { scripts: [script] }), { x: 0, y: 100 });
    const cap = w.energy(r.id)?.capacity;
    untilBuilt(w);
    run(w, 3);
    expect(w.scriptLogs.at(-1)?.text).toBe(`${cap} ${cap}`);
    w.dispose();
  });

  it('an empty carrier cannot touch it, and it launches exactly as full as it was built', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy()), { x: 0, y: 100 });
    untilBuilt(w);
    w.step([{ robot: r.id, pressed: ['t'], released: [] }]);
    for (const p of r.parts.values()) if (!held(r).includes(p) && p.stored !== undefined) p.stored = 5;
    run(w, 60);
    expect(w.energy(r.id)?.stored).toBeCloseTo(0, 6);
    expect(charge(held(r))).toBe(FULL);
    release(w, r);
    const woke = w.events.find((e) => e.kind === 'coreWoke');
    expect(w.energy(woke?.robot ?? 0)?.stored).toBe(FULL);
    expect(w.energy(woke?.robot ?? 0)?.capacity).toBe(FULL);
    w.dispose();
  });

  it('its sensors and gyros, on by default, draw nothing from anyone: it holds full for a minute', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy({ part: 'radar', x: 0, y: 3 }, { part: 'seeker', x: 0, y: 4 })), { x: 0, y: 100 });
    untilBuilt(w);
    const used = w.energy(r.id)?.used;
    const stored = w.energy(r.id)?.stored;
    // The bay starts on nothing more while it holds, so all that could move is the copy's sensors.
    run(w, 3600);
    expect(w.energy(r.id)?.used).toBe(used);
    expect(w.energy(r.id)?.stored).toBe(stored);
    expect(charge(held(r))).toBe(FULL);
    w.dispose();
  });

  it('a carrier cannot see through a held copy, and the copy sees once it is let go', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy({ part: 'radar', x: 0, y: 3 })), { x: 0, y: 100 });
    untilBuilt(w);
    run(w, 2);
    expect(held(r).find((p) => p.def.id === 'radar')?.sensing).toBe(false);
    release(w, r);
    const woke = w.events.find((e) => e.kind === 'coreWoke');
    const piece = w.robots.find((x) => x.id === woke?.robot);
    run(w, 1);
    expect([...(piece?.parts.values() ?? [])].find((p) => p.def.id === 'radar')?.sensing).toBe(true);
    w.dispose();
  });

  it('its own parts get no power while held: a script on its thruster moves nothing and costs nothing', async () => {
    const w = await world(1, host);
    const script = { id: 'drive', enabled: true, source: 'function tick() { set("bay1.tail", "throttle", 1); }' };
    const r = w.spawnBlueprint(carrier(copy({ part: 'thruster', x: 0, y: 3, rot: 180, tags: ['tail'] }), { scripts: [script] }), { x: 0, y: 100 });
    untilBuilt(w);
    run(w, 2);
    const used = w.energy(r.id)?.used;
    const body = r.groups[0]?.bodyId ?? 0;
    const at = w.physics.state(body).y;
    run(w, 120);
    expect(w.channelValue(r.id, held(r).find((p) => p.def.id === 'thruster')?.id ?? '', 'throttle')).toBe(1);
    expect(w.energy(r.id)?.used).toBe(used);
    expect(charge(held(r))).toBe(FULL);
    expect(w.physics.state(r.groups[0]?.bodyId ?? 0).y).toBeCloseTo(at, 6);
    w.dispose();
  });

  it('a joint in a held copy holds what it carries for nothing: a turret does not swing about in its bay', async () => {
    const w = await World.create({ seed: 1, scripts: host }, parseWorldFile(flatJson));
    const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
    const r = w.spawnBlueprint(resolveScripts(JSON.parse(bpFile('enemy-hunter-carrier.json')), bpFile).raw, { x: -100, y: 30 });
    untilBuilt(w);
    const rotators = held(r).filter((p) => p.def.behavior === 'rotator');
    expect(rotators.length).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) {
      w.step();
      for (const p of rotators) {
        const joint = r.groups[p.group]?.joint;
        if (joint) expect(Math.abs(w.physics.jointAngle(joint.jointId))).toBeLessThan(0.1);
      }
    }
    w.dispose();
  });

  it('a reactor and a solar panel in a held copy make nothing for the carrier, and are not its reactors', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy({ part: 'smallreactor', x: 0, y: 3 })), { x: 0, y: 100 });
    untilBuilt(w);
    for (const p of r.parts.values()) if (!held(r).includes(p) && p.stored !== undefined) p.stored = 0;
    run(w, 30);
    expect(w.energy(r.id)?.stored).toBe(0);
    expect(w.reactors(r.id)).toBeUndefined();
    expect(w.powered(r.id)).toBe(false);
    w.dispose();
  });

  it('a reactor on the carrier does not fill a held copy, and frying never picks one', async () => {
    const w = await world();
    const laser = { parts: [{ part: 'smallreactor', x: -4, y: 0 }, { part: 'laser', x: -3, y: 1, tags: ['laser'] }], bindings: [{ key: 'f', mode: 'hold', target: 'laser', channel: 'fire', value: 1 }] };
    const r = w.spawnBlueprint(carrier(copy(), laser), { x: 0, y: 100 });
    untilBuilt(w);
    const dense = held(r).find((p) => p.def.id === 'densebattery');
    if (dense?.stored !== undefined) dense.stored -= 3000;
    const copyHas = charge(held(r));
    const health = dense?.health;
    const inCopy = new Set(held(r).map((p) => p.id));
    for (const p of r.parts.values()) if (!inCopy.has(p.id) && p.stored !== undefined) p.stored = 0;
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    run(w, 1200);
    expect(w.events.some((e) => e.kind === 'overload')).toBe(true);
    const cooked = w.events.filter((e) => e.kind === 'partDestroyed' && e.cooked === true);
    expect(cooked.length).toBeGreaterThan(0);
    expect(cooked.some((e) => e.kind === 'partDestroyed' && inCopy.has(e.part))).toBe(false);
    expect(dense?.health).toBe(health);
    expect(charge(held(r))).toBe(copyHas);
    w.dispose();
  });

  it('a bay shot out frees its copy, its charge whole and its own', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy()), { x: 0, y: 100 });
    untilBuilt(w);
    const bay = r.parts.get(BAY);
    if (bay) bay.health = 0;
    run(w, 2);
    const woke = w.events.find((e) => e.kind === 'coreWoke');
    expect(woke).toBeDefined();
    expect(w.energy(woke?.robot ?? 0)).toMatchObject({ stored: FULL, capacity: FULL });
    w.dispose();
  });

  it('a carrier with its core shot out leaves a dud: the wreck\'s parts cannot drain it, nothing wakes', async () => {
    const w = await world();
    const r = w.spawnBlueprint(carrier(copy()), { x: 0, y: 100 });
    untilBuilt(w);
    w.step([{ robot: r.id, pressed: ['t'], released: [] }]);
    const core = r.parts.get('core@0,0');
    if (core) core.health = 0;
    run(w, 600);
    expect(w.canControl(r.id)).toBe(false);
    expect(w.events.some((e) => e.kind === 'coreWoke')).toBe(false);
    expect(charge(held(r))).toBe(FULL);
    w.dispose();
  });

  it('a piece that breaks off with the bay wakes the copy, and the copy is that piece: the seal is gone', async () => {
    const w = await world();
    // The core sits on a decoupler under the bay: fired, the bay, its copy and a battery go off alone.
    const raw = {
      format: 1,
      name: 'carrier',
      parts: [
        { part: 'core', x: 0, y: -2 },
        { part: 'decoupler', x: 0, y: -1, tags: ['cut'] },
        { part: 'frame', x: 0, y: 0 },
        { part: 'densebattery', x: -1, y: 0 },
        { part: 'densebattery', x: -2, y: 0 },
        { part: 'densebattery', x: -3, y: 0 },
        { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
      ],
      recipes: { item: copy() },
      bindings: [{ key: 'c', mode: 'pulse', target: 'cut', channel: 'fire', value: 1 }],
    };
    const r = w.spawnBlueprint(raw, { x: 0, y: 100 });
    untilBuilt(w);
    const onPiece = charge(['densebattery@-1,0', 'densebattery@-2,0', 'densebattery@-3,0'].map((id) => r.parts.get(id) as PartInstance));
    w.step([{ robot: r.id, pressed: ['c'], released: [] }]);
    run(w, 1);
    const woke = w.events.find((e) => e.kind === 'coreWoke');
    expect(woke).toBeDefined();
    const e = w.energy(woke?.robot ?? 0);
    expect(e?.capacity).toBe(FULL + 18000);
    expect(e?.stored).toBeCloseTo(FULL + onPiece, 3);
    w.dispose();
  });

  it('two runs with a copy held and a launch end the same', async () => {
    const play = async (): Promise<string> => {
      const w = await world(3);
      const r = w.spawnBlueprint(carrier(copy()), { x: 0, y: 100 });
      untilBuilt(w);
      release(w, r);
      run(w, 60);
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await play()).toBe(await play());
  });
});
