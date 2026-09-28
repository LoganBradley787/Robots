import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { parsePartDef } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import { DEFAULT_LEGEND } from '../src/blueprint/legend';
import { smokeBlocks } from '../src/sensors/smoke';
import { sees } from '../src/sensors/sight';
import { SIGHT } from '../src/weapons/shells';

/** No gravity, a small ground far below, so nothing moves on its own. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });
const flat = parseWorldFile(flatJson);
const RADAR = { format: 1, name: 'radar-bot', grid: ['C  O  B'] };
const TARGET = { format: 1, name: 'target', grid: ['C  F'] };
const POD = { format: 1, name: 'pod-bot', grid: ['C  U'], bindings: [{ key: 's', mode: 'hold', target: 'smoke', channel: 'on', value: 1 }] };
/** A radar with a pod on it. */
const POD_RADAR = { format: 1, name: 'pod-radar', grid: ['C  O  U'], bindings: [{ key: 's', mode: 'hold', target: 'smoke', channel: 'on', value: 1 }] };
const press = (robot: number) => [{ robot, pressed: ['s'], released: [] }];
const release = (robot: number) => [{ robot, pressed: [], released: ['s'] }];

async function space0(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0 }, space);
}
function sees0(w: World, id: number, target: number): boolean {
  return w.sensorView(id).contacts.some((c) => c.id === target);
}

describe('smoke pod (Batch)', () => {
  it('is a shipped part with a smoke block, legend U, and no builder key', () => {
    const d = defaultRegistry().get('smoke');
    expect(d).toMatchObject({ mass: 0.4, health: 10, smoke: { radius: 12, seconds: 8 } });
    expect(d.inputs.map((c) => c.name)).toEqual(['on']);
    expect(DEFAULT_LEGEND.U).toEqual({ part: 'smoke' });
    expect(defaultRegistry().list().filter((p) => p.smoke !== undefined).map((p) => p.id)).toEqual(['smoke']);
  });

  it('the parser wants an on input and positive numbers', () => {
    const raw = JSON.parse(JSON.stringify(defaultRegistry().get('smoke')));
    expect(() => parsePartDef({ ...raw, inputs: [] }, 'x.json')).toThrow('must have an "on" input');
    expect(() => parsePartDef({ ...raw, smoke: { radius: 0, seconds: 8 } }, 'x.json')).toThrow();
    expect(() => parsePartDef({ ...raw, smoke: { radius: 12 } }, 'x.json')).toThrow();
    expect(() => parsePartDef({ ...raw, smoke: { radius: 12, seconds: 8, x: 1 } }, 'x.json')).toThrow();
  });

  it('smokeBlocks: a circle touching the segment, either end inside counts', () => {
    const c = { x: 0, y: 0, radius: 2 };
    expect(smokeBlocks(c, -10, 1, 10, 1)).toBe(true);
    expect(smokeBlocks(c, -10, 3, 10, 3)).toBe(false);
    expect(smokeBlocks(c, 0, 1, 50, 1)).toBe(true);
    expect(smokeBlocks(c, 5, 0, 50, 0)).toBe(false);
    expect(smokeBlocks(c, 0, 0, 0, 0)).toBe(true);
    const s = { id: 's', x: -10, y: 0, facing: 0, cone: 360, range: 100 };
    expect(sees(s, { x: 10, y: 0 }, [])).toBe(true);
    expect(sees(s, { x: 10, y: 0 }, [], [{ x: 0, y: 0, radius: 2, left: 5, total: 5 }])).toBe(false);
  });

  it('a radar loses a target behind a cloud and finds it again when the cloud clears', async () => {
    const w = await space0();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(TARGET, { x: 40, y: 100 }, { team: 1 });
    const pod = w.spawnBlueprint(POD, { x: 20, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(sees0(w, me.id, target.id)).toBe(true);
    expect(w.smokeClouds()).toHaveLength(0);
    w.step(press(pod.id));
    w.step(release(pod.id));
    // The pod is used up, quietly, and one cloud sits where it was.
    expect(w.smokeClouds()).toHaveLength(1);
    expect(w.robotById(pod.id)?.parts.has('smoke@1,0')).toBe(false);
    expect(w.events.some((e) => e.kind === 'smoked')).toBe(true);
    expect(w.events.some((e) => e.kind === 'explosion')).toBe(false);
    expect(sees0(w, me.id, target.id)).toBe(false);
    // Lasts 8 s: still hidden at 7 s, seen again a moment after 8 s.
    for (let i = 0; i < 60 * 7; i++) w.step();
    expect(w.smokeClouds()).toHaveLength(1);
    expect(sees0(w, me.id, target.id)).toBe(false);
    for (let i = 0; i < 90; i++) w.step();
    expect(w.smokeClouds()).toHaveLength(0);
    expect(sees0(w, me.id, target.id)).toBe(true);
    w.dispose();
  });

  it('a cloud off the line of sight hides nothing, and it drifts down at 0.5 m/s', async () => {
    const w = await space0();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(TARGET, { x: 40, y: 100 }, { team: 1 });
    const pod = w.spawnBlueprint(POD, { x: 20, y: 130 }, { team: 1 });
    w.step(press(pod.id));
    const y0 = w.smokeClouds()[0]?.y ?? NaN;
    for (let i = 0; i < 120; i++) w.step();
    expect(w.smokeClouds()[0]?.y).toBeCloseTo(y0 - 1, 6);
    expect(sees0(w, me.id, target.id)).toBe(true);
    w.dispose();
  });

  it('a sensor inside a cloud sees nothing, and a robot inside one is not seen', async () => {
    const w = await space0();
    const me = w.spawnBlueprint(POD_RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(TARGET, { x: 40, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    expect(sees0(w, me.id, target.id)).toBe(true);
    w.step(press(me.id));
    expect(sees0(w, me.id, target.id)).toBe(false);
    w.dispose();
    // Turned round: the target inside the cloud is hidden from a radar outside it.
    const w2 = await space0();
    const watcher = w2.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const hidden = w2.spawnBlueprint(POD_RADAR, { x: 30, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w2.step();
    expect(sees0(w2, watcher.id, hidden.id)).toBe(true);
    w2.step(press(hidden.id));
    expect(sees0(w2, watcher.id, hidden.id)).toBe(false);
    w2.dispose();
  });

  it('gun sights see through smoke', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const gunner = w.spawnBlueprint({ format: 1, name: 'gunner', grid: ['C M>'] }, { x: -100, y: 0.5 });
    w.spawnBlueprint(TARGET, { x: -70, y: 0.5 }, { team: 1 });
    const pod = w.spawnBlueprint(POD, { x: -85, y: 0.5 }, { team: 1 });
    for (let i = 0; i < 3; i++) w.step();
    w.step(press(pod.id));
    expect(w.smokeClouds()).toHaveLength(1);
    expect(w.partOutput(gunner.id, 'gun@1,0', 'sightSide')).toBe(SIGHT.enemy);
    w.dispose();
  });

  it('a cloud is part of the hash while it lasts, and the same run gives the same hashes', async () => {
    const run = async (): Promise<string[]> => {
      const w = await space0();
      w.spawnBlueprint(RADAR, { x: 0, y: 100 });
      w.spawnBlueprint(TARGET, { x: 40, y: 100 }, { team: 1 });
      const pod = w.spawnBlueprint(POD, { x: 20, y: 100 }, { team: 1 });
      const out: string[] = [];
      w.step(press(pod.id));
      out.push(w.hash());
      w.step();
      out.push(w.hash());
      w.dispose();
      return out;
    };
    const a = await run();
    expect(await run()).toEqual(a);
    expect(a[1]).not.toBe(a[0]);
    // Worlds without smoke keep their hashes: the golden scenes (packages/cli) and determinism snapshots pin that.
  });
});
