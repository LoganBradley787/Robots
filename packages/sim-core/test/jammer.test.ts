import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { jammed } from '../src/sensors/jam';
import { defaultRegistry } from '../src/parts/registry';
import { parsePartDef } from '../src/parts/parsePartDef';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** No gravity and nothing to block a view: a small ground far below. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });
const LIGHT = [{ key: 'v', mode: 'pulse', target: 'jammer', channel: 'ignite', value: 1 }];
const RELEASE = [...LIGHT, { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }];
/** A radar with a battery. */
const EYE = { format: 1, name: 'eye', grid: ['C  O  B'] };
/** A radar bot with a pod on its left: V lights it. */
const EYE_POD = { format: 1, name: 'eye-pod', grid: ['J  C  O  B'], bindings: LIGHT };
/** A bot with a pod on top: V lights it. */
const POD_BOT = { format: 1, name: 'pod-bot', grid: ['J', 'C', 'B'], bindings: LIGHT };
/** A radar, a core, and a pod on a decoupler on the right that lets go on V, lit. */
const LAUNCHER = { format: 1, name: 'launcher', grid: ['O  C  B  D>  J'], bindings: RELEASE };
const PLAIN = { format: 1, name: 'plain', grid: ['C  B'] };
const TICKS = 5 * 60;

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}
function light(w: World, r: Robot): void {
  w.step([{ robot: r.id, pressed: ['v'], released: [] }]);
  w.step([{ robot: r.id, pressed: [], released: ['v'] }]);
}
const ids = (w: World, viewer: Robot): number[] => w.sensorView(viewer.id).contacts.map((c) => c.id);

describe('jammer pod (Batch)', () => {
  it('a radar sees everything in range until a pod lights', async () => {
    const w = await world();
    const eye = w.spawnBlueprint(EYE, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 }, { team: 1 });
    const plain = w.spawnBlueprint(PLAIN, { x: 210, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(ids(w, eye)).toEqual([pod.id, plain.id]);
    expect(w.partOutput(pod.id, 'jammer@0,2', 'jamming')).toBe(0);
    w.dispose();
  });

  it('outside a bubble: a sensor does not see a robot whose reference point is inside it, but sees ones outside', async () => {
    const w = await world();
    const eye = w.spawnBlueprint(EYE, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 }, { team: 1 });
    w.spawnBlueprint(PLAIN, { x: 220, y: 100 }, { team: 1 });
    const far = w.spawnBlueprint(PLAIN, { x: 260, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    light(w, pod);
    expect(w.partOutput(pod.id, 'jammer@0,2', 'jamming')).toBe(1);
    // The pod's own robot and the one 20 m away are hidden; the one 60 m away is not.
    expect(ids(w, eye)).toEqual([far.id]);
    expect(w.events.filter((e) => e.kind === 'jamStarted')).toMatchObject([{ robot: pod.id, part: 'jammer@0,2', radius: 30 }]);
    w.dispose();
  });

  it('the bubble is 30 m: a robot just inside is hidden, just outside is seen', async () => {
    const w = await world();
    const eye = w.spawnBlueprint(EYE, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 }, { team: 1 });
    const inside = w.spawnBlueprint(PLAIN, { x: 227, y: 100 }, { team: 1 });
    const outside = w.spawnBlueprint(PLAIN, { x: 234, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    light(w, pod);
    const podAt = partWorldPose(w, pod, 'jammer@0,2');
    const seen = ids(w, eye);
    expect(seen).toContain(outside.id);
    expect(seen).not.toContain(inside.id);
    expect(Math.abs(partWorldPose(w, inside, inside.rootId).x - podAt.x)).toBeLessThan(30);
    expect(Math.abs(partWorldPose(w, outside, outside.rootId).x - podAt.x)).toBeGreaterThan(30);
    w.dispose();
  });

  it('inside a bubble: a sensor sees nothing, however near or far the target', async () => {
    const w = await world();
    const eye = w.spawnBlueprint(EYE_POD, { x: 0, y: 100 });
    const near = w.spawnBlueprint(PLAIN, { x: 10, y: 100 }, { team: 1 });
    const far = w.spawnBlueprint(PLAIN, { x: 300, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(ids(w, eye)).toEqual([near.id, far.id]);
    light(w, eye);
    expect(ids(w, eye)).toEqual([]);
    w.dispose();
  });

  it('scripts get no contacts inside a bubble', async () => {
    const w = await world();
    const src = 'function tick() { log(contacts.length); }';
    const eye = w.spawnBlueprint({ ...EYE_POD, scripts: [{ id: 'look', source: src }] }, { x: 0, y: 100 });
    w.spawnBlueprint(PLAIN, { x: 100, y: 100 }, { team: 1 });
    for (let i = 0; i < 10; i++) w.step();
    light(w, eye);
    for (let i = 0; i < 10; i++) w.step();
    const logs = w.scriptLogs.filter((l) => l.robot === eye.id).map((l) => l.text);
    expect(logs[5]).toBe('1');
    expect(logs[logs.length - 1]).toBe('0');
    w.dispose();
  });

  it('jams for 5 s, then the pod is gone quietly and sight returns', async () => {
    const w = await world();
    const eye = w.spawnBlueprint(EYE, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    light(w, pod);
    // Lit on the tick V went down: it jams 300 ticks in all, that tick the first (two are done, then 298 more leave one).
    for (let i = 0; i < TICKS - 2; i++) w.step();
    expect(w.partOutput(pod.id, 'jammer@0,2', 'jamming')).toBe(1);
    expect(ids(w, eye)).toEqual([]);
    w.step();
    expect(pod.parts.has('jammer@0,2')).toBe(false);
    expect(ids(w, eye)).toEqual([pod.id]);
    expect(w.events.filter((e) => e.kind === 'burntOut')).toMatchObject([{ robot: pod.id, part: 'jammer@0,2' }]);
    expect(w.events.filter((e) => e.kind === 'partDestroyed')).toMatchObject([{ part: 'jammer@0,2', exploded: false, burntOut: true }]);
    expect(w.events.filter((e) => e.kind === 'explosion')).toHaveLength(0);
    expect(pod.parts.size).toBe(2);
    w.dispose();
  });

  it('stays lit when the key is released, and a second press does not restart it', async () => {
    const w = await world();
    const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 });
    light(w, pod);
    for (let i = 0; i < 100; i++) w.step();
    expect(w.partOutput(pod.id, 'jammer@0,2', 'jamming')).toBe(1);
    light(w, pod);
    expect(w.events.filter((e) => e.kind === 'jamStarted')).toHaveLength(1);
    for (let i = 0; i < TICKS - 100; i++) w.step();
    expect(pod.parts.has('jammer@0,2')).toBe(false);
    w.dispose();
  });

  it('let go, the bubble stays with the pod: it blinds the robot that released it while near, and hides the pod', async () => {
    const w = await world();
    const bot = w.spawnBlueprint(LAUNCHER, { x: 0, y: 100 });
    const other = w.spawnBlueprint(EYE, { x: 300, y: 100 }, { team: 1 });
    const target = w.spawnBlueprint(PLAIN, { x: 100, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(ids(w, bot)).toContain(target.id);
    light(w, bot);
    const piece = w.robots.find((r) => r.parts.has('jammer@4,0') && r.id !== bot.id);
    if (!piece) throw new Error('the pod did not split off');
    expect(w.partOutput(piece.id, 'jammer@4,0', 'jamming')).toBe(1);
    // Within 30 m of the pod, the launcher's radar sees nothing; the far eye does not see the pod's piece.
    const podAt = partWorldPose(w, piece, 'jammer@4,0');
    expect(Math.hypot(partWorldPose(w, bot, 'radar@0,0').x - podAt.x, 0)).toBeLessThan(30);
    expect(ids(w, bot)).toEqual([]);
    expect(ids(w, other)).not.toContain(piece.id);
    expect(ids(w, other)).toContain(target.id);
    w.dispose();
  });

  it('gun sights are not sensors: a gun keeps reading what is on its line while jammed', async () => {
    const w = await world();
    const car = w.spawnBlueprint({ format: 1, name: 'gun-pod', grid: ['J  C  M>'], bindings: LIGHT }, { x: 0, y: 100 });
    w.spawnBlueprint({ format: 1, name: 'post', grid: ['C'] }, { x: 40, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(w.partOutput(car.id, 'gun@2,0', 'sightSide')).toBe(3);
    light(w, car);
    expect(w.partOutput(car.id, 'jammer@0,0', 'jamming')).toBe(1);
    w.step();
    expect(w.partOutput(car.id, 'gun@2,0', 'sightSide')).toBe(3);
    expect(w.partOutput(car.id, 'gun@2,0', 'sight')).toBeLessThan(40);
    w.dispose();
  });

  it('two jammers make two bubbles; a point in either is jammed', () => {
    const bubbles = [
      { x: 0, y: 0, radius: 30 },
      { x: 100, y: 0, radius: 30 },
    ];
    expect(jammed(bubbles, { x: 20, y: 0 })).toBe(true);
    expect(jammed(bubbles, { x: 120, y: 10 })).toBe(true);
    expect(jammed(bubbles, { x: 60, y: 0 })).toBe(false);
    expect(jammed(bubbles, { x: 30, y: 0 })).toBe(true);
    expect(jammed([], { x: 0, y: 0 })).toBe(false);
  });

  it('the jam timer is hashed: same run, same hash; different timing, different hash', async () => {
    const run = async (lightAt: number): Promise<string> => {
      const w = await world();
      const pod = w.spawnBlueprint(POD_BOT, { x: 200, y: 100 });
      for (let i = 0; i < 40; i++) {
        const press = i === lightAt ? [{ robot: pod.id, pressed: ['v'], released: [] }] : i === lightAt + 1 ? [{ robot: pod.id, pressed: [], released: ['v'] }] : [];
        w.step(press);
      }
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run(10)).toBe(await run(10));
    expect(await run(10)).not.toBe(await run(12));
    expect(await run(10)).not.toBe(await run(100));
  });

  it('worlds with no jammer keep their hashes (the golden scenes pin the shipped ones): same world, same hash', async () => {
    const make = async (): Promise<string> => {
      const w = await world();
      w.spawnBlueprint(EYE, { x: 0, y: 100 });
      w.spawnBlueprint(PLAIN, { x: 50, y: 100 }, { team: 1 });
      for (let i = 0; i < 30; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await make()).toBe(await make());
  });

  it('the def parses: 30 m, 5 s, and needs ignite and jamming', () => {
    expect(defaultRegistry().get('jammer')).toMatchObject({ mass: 0.5, health: 10, jammer: { radius: 30, seconds: 5 } });
    const raw = { id: 'j', name: 'J', footprint: [{ x: 0, y: 0, faces: ['S'] }], mass: 1, health: 5, symmetry: 4, inputs: [], outputs: [], powerDraw: 0, jammer: { radius: 30, seconds: 5 }, sprite: { frame: 'part.jammer' } };
    expect(() => parsePartDef(raw, 'j.json')).toThrow(/ignite/);
    expect(() => parsePartDef({ ...raw, inputs: [{ name: 'ignite', min: 0, max: 1, default: 0 }] }, 'j.json')).toThrow(/jamming/);
  });
});
