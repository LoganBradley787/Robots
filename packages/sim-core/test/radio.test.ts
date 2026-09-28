import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** No gravity, a small ground far below, no walls. Everything flies at y 300. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 300 } });
/** Logs what it sees on its third frame: [id, side, by, distance]. */
const LOOK = `
  function tick() {
    if (frame !== 3) return;
    log(JSON.stringify(contacts.map(function (c) { return [c.id, c.side, c.by.join(','), Math.round(c.distance)]; })));
    log(JSON.stringify(contacts.map(function (c) { return scan(c.id) === null; })));
  }`;
/** A radio and no sensor. */
const BLIND = { format: 1, name: 'blind', grid: ['C  N  B'], scripts: [{ id: 'look', source: LOOK }] };
/** A radar and a radio. */
const SCOUT = { format: 1, name: 'scout', grid: ['C  O  N  B'] };
/** A radar and no radio. */
const LONE = { format: 1, name: 'lone', grid: ['C  O  B'] };
const TARGET = { format: 1, name: 'target', grid: ['C  B'] };
const LIGHT = [
  { key: 'v', mode: 'pulse', target: 'flare', channel: 'ignite', value: 1 },
  { key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 },
];
const FLARER = { format: 1, name: 'flarer', grid: ['C  D>  Q>'], bindings: LIGHT };

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}
/** What the viewer's script logged: [[id, side, by, distance]] then whether each contact's scan is null. */
function looked(w: World, viewer: Robot): { seen: [number, string, string, number][]; scanNull: boolean[] } {
  const logs = w.scriptLogs.filter((l) => l.robot === viewer.id).map((l) => l.text);
  return { seen: JSON.parse(logs[0] ?? '[]'), scanNull: JSON.parse(logs[1] ?? '[]') };
}
function run(w: World, ticks = 5): void {
  for (let i = 0; i < ticks; i++) w.step();
}

describe('radio (Batch)', () => {
  it('a robot with no radar sees the enemy a radio friend 800 m away tracks, listed by "radio"', async () => {
    const w = await world();
    const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
    const friend = w.spawnBlueprint(SCOUT, { x: 800, y: 300 });
    const enemy = w.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
    run(w);
    const { seen, scanNull } = looked(w, me);
    // The friend's radar sees the enemy (300 m away) and me (800 m is out of its 500 m), so only the enemy is shared.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.slice(0, 3)).toEqual([enemy.id, 'enemy', 'radio']);
    // Its distance is from my core, not the friend's.
    expect(seen[0]?.[3]).toBeGreaterThan(1090);
    expect(seen[0]?.[3]).toBeLessThan(1101);
    // Shared contacts cannot be scanned: scan needs my own sensors.
    expect(scanNull).toEqual([true]);
    expect(w.sensorView(me.id).contacts.map((c) => c.id)).toEqual([enemy.id]);
    expect(w.sensorView(friend.id).contacts.map((c) => c.id)).toContain(enemy.id);
    w.dispose();
  });

  it('without a working radio on either end nothing is shared', async () => {
    // My radio is switched off by my script.
    const w = await world();
    const off = w.spawnBlueprint({ ...BLIND, scripts: [{ id: 'off', source: "function tick() { set('radio', 'on', 0); }" }] }, { x: 0, y: 300 });
    w.spawnBlueprint(SCOUT, { x: 800, y: 300 });
    w.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
    run(w);
    expect(w.sensorView(off.id).contacts).toEqual([]);
    w.dispose();
    // The scout has a radar but no radio.
    const w2 = await world();
    const plain = w2.spawnBlueprint(BLIND, { x: 0, y: 300 });
    w2.spawnBlueprint(LONE, { x: 800, y: 300 });
    w2.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
    run(w2);
    expect(w2.sensorView(plain.id).contacts).toEqual([]);
    w2.dispose();
  });

  it('not when the friend’s radio is destroyed (or switched off)', async () => {
    const w = await world();
    const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
    const friend = w.spawnBlueprint(SCOUT, { x: 800, y: 300 });
    const enemy = w.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
    run(w);
    expect(w.sensorView(me.id).contacts.map((c) => c.id)).toEqual([enemy.id]);
    const radio = friend.parts.get('radio@2,0');
    if (!radio) throw new Error('no radio');
    radio.health = 0;
    run(w, 2);
    expect(friend.parts.has('radio@2,0')).toBe(false);
    // The radar still tracks the enemy, but the radio that told me is gone.
    expect(w.sensorView(friend.id).contacts.map((c) => c.id)).toContain(enemy.id);
    expect(w.sensorView(me.id).contacts).toEqual([]);
    w.dispose();
    // Switched off: the same.
    const w2 = await world();
    const me2 = w2.spawnBlueprint(BLIND, { x: 0, y: 300 });
    w2.spawnBlueprint({ ...SCOUT, scripts: [{ id: 'off', source: "function tick() { set('radio', 'on', 0); }" }] }, { x: 800, y: 300 });
    w2.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
    run(w2);
    expect(w2.sensorView(me2.id).contacts).toEqual([]);
    w2.dispose();
  });

  it('not when the radios are further apart than 1500 m', async () => {
    const near = await world();
    const me = near.spawnBlueprint(BLIND, { x: 0, y: 300 });
    near.spawnBlueprint(SCOUT, { x: 1400, y: 300 });
    const enemy = near.spawnBlueprint(TARGET, { x: 1700, y: 300 }, { team: 1 });
    run(near);
    expect(near.sensorView(me.id).contacts.map((c) => c.id)).toEqual([enemy.id]);
    near.dispose();
    const far = await world();
    const me2 = far.spawnBlueprint(BLIND, { x: 0, y: 300 });
    far.spawnBlueprint(SCOUT, { x: 1600, y: 300 });
    far.spawnBlueprint(TARGET, { x: 1900, y: 300 }, { team: 1 });
    run(far);
    expect(far.sensorView(me2.id).contacts).toEqual([]);
    far.dispose();
  });

  it('not across teams', async () => {
    const w = await world();
    const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
    w.spawnBlueprint(SCOUT, { x: 800, y: 300 }, { team: 1 });
    w.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 2 });
    run(w);
    expect(w.sensorView(me.id).contacts).toEqual([]);
    w.dispose();
  });

  it('does not relay: a friend that only heard it by radio passes nothing on', async () => {
    const w = await world();
    const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
    const middle = w.spawnBlueprint(BLIND, { x: 1400, y: 300 });
    const outpost = w.spawnBlueprint(SCOUT, { x: 2800, y: 300 });
    const enemy = w.spawnBlueprint(TARGET, { x: 3000, y: 300 }, { team: 1 });
    run(w);
    // The outpost is 1400 m from the middle robot, 2800 from me.
    expect(w.sensorView(middle.id).contacts.map((c) => c.id)).toEqual([enemy.id]);
    expect(w.sensorView(outpost.id).contacts.map((c) => c.id)).toEqual([enemy.id]);
    expect(w.sensorView(me.id).contacts).toEqual([]);
    w.dispose();
  });

  it('a robot that already sees something keeps its own sensor as the source; the rest is shared', async () => {
    const w = await world();
    const me = w.spawnBlueprint({ ...SCOUT, scripts: [{ id: 'look', source: LOOK }] }, { x: 0, y: 300 });
    w.spawnBlueprint(SCOUT, { x: 700, y: 300 });
    const near = w.spawnBlueprint(TARGET, { x: 300, y: 300 }, { team: 1 });
    const seenByFriend = w.spawnBlueprint(TARGET, { x: 1000, y: 300 }, { team: 1 });
    run(w);
    const { seen } = looked(w, me);
    // Both are visible to the friend's radar; the near one is also on my radar (500 m), so it stays mine.
    expect(seen.map((s) => [s[0], s[2]])).toEqual([
      [near.id, 'radar@1,0'],
      [seenByFriend.id, 'radio'],
    ]);
    w.dispose();
  });

  it('a burning flare shared by radio keeps fooling: the robot is reported at the flare', async () => {
    const w = await world();
    const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
    w.spawnBlueprint(SCOUT, { x: 600, y: 300 });
    const target = w.spawnBlueprint(FLARER, { x: 900, y: 300 }, { team: 1 });
    w.step([{ robot: target.id, pressed: ['v'], released: [] }]);
    w.step([{ robot: target.id, pressed: [], released: ['v'] }]);
    run(w, 20);
    const flare = w.robots.find((r) => r.parts.get('flare@2,0')?.decoyOf === target.id);
    if (!flare) throw new Error('no burning flare');
    const at = partWorldPose(w, flare, 'flare@2,0');
    const seen = w.sensorView(me.id).contacts;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: target.id, side: 'enemy', decoy: true });
    expect(seen[0]?.x).toBeCloseTo(at.x, 6);
    expect(seen[0]?.y).toBeCloseTo(at.y, 6);
    w.dispose();
  });

  it('draws 1 J/s, and is deterministic with the radio in the hash', async () => {
    const hashes: string[] = [];
    for (let k = 0; k < 2; k++) {
      const w = await world();
      const me = w.spawnBlueprint(BLIND, { x: 0, y: 300 });
      w.spawnBlueprint(SCOUT, { x: 800, y: 300 });
      w.spawnBlueprint(TARGET, { x: 1100, y: 300 }, { team: 1 });
      run(w, 60);
      expect(w.energy(me.id)?.used).toBeCloseTo(1, 5);
      hashes.push(w.hash());
      w.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('parses: it must use the sensor behavior, have an "on" input, and a positive range', () => {
    const base = { id: 'r', name: 'R', footprint: [{ x: 0, y: 0, faces: ['N'] }], mass: 1, health: 10, symmetry: 1, inputs: [{ name: 'on', min: 0, max: 1, default: 1 }], outputs: [], powerDraw: 1, behavior: 'sensor', radio: { range: 100 }, sprite: { frame: 'part.r' } };
    expect(parsePartDef(base, 'radio.json').radio).toEqual({ range: 100 });
    expect(() => parsePartDef({ ...base, radio: { range: 0 } }, 'radio.json')).toThrow(PartDefError);
    expect(() => parsePartDef({ ...base, radio: { range: 100, extra: 1 } }, 'radio.json')).toThrow(PartDefError);
    expect(() => parsePartDef({ ...base, behavior: 'wheel' }, 'radio.json')).toThrow(PartDefError);
    expect(() => parsePartDef({ ...base, inputs: [] }, 'radio.json')).toThrow(PartDefError);
    expect(defaultRegistry().get('radio')).toMatchObject({ mass: 1, health: 30, powerDraw: 1, radio: { range: 1500 } });
  });
});
