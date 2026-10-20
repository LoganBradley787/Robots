import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { buildReplay, parseReplay, runReplay } from '../src/replay/replayFile';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** No gravity, a small ground far below, so nothing moves on its own and nothing blocks a view. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 } });
const flat = parseWorldFile(flatJson);
const SMOKE_KEY = [{ key: 's', mode: 'hold', target: 'smoke', channel: 'on', value: 1 }];
const JAM_KEY = [{ key: 'v', mode: 'pulse', target: 'jammer', channel: 'ignite', value: 1 }];
const RADAR = { format: 1, name: 'radar-bot', grid: ['C  O  B'] };
const TARGET = { format: 1, name: 'target', grid: ['C  F'] };
const POD = { format: 1, name: 'pod-bot', grid: ['C  U'], bindings: SMOKE_KEY };
/** A radar with a smoke pod on it. */
const POD_RADAR = { format: 1, name: 'pod-radar', grid: ['C  O  U'], bindings: SMOKE_KEY };
/** A bot with a jammer on top: V lights it. */
const JAM_BOT = { format: 1, name: 'jam-bot', grid: ['J', 'C', 'B'], bindings: JAM_KEY };
/** A radar bot with a jammer on its left: V lights it. */
const JAM_RADAR = { format: 1, name: 'jam-radar', grid: ['J  C  O  B'], bindings: JAM_KEY };
/** A dense battery, a core, and a laser pointing right: F fires. */
const RIG = { format: 1, name: 'laser-rig', grid: ['Z C Lz> ='], bindings: [{ key: 'f', mode: 'hold', target: 'laser', channel: 'fire', value: 1 }] };
const PLATE = { format: 1, name: 'plate', grid: ['A'] };
/** Logs whether it sees the first contact and whether scan() of it gives its parts. */
const LOOK = 'function tick() { var c = contacts[0]; log(c ? String(c.id) + " " + (scan(c.id) !== null) : "none"); }';

async function space0(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}
const key = (r: Robot, k: string, down: boolean) => [{ robot: r.id, pressed: down ? [k] : [], released: down ? [] : [k] }];
const sees = (w: World, viewer: Robot, target: Robot): boolean => w.sensorView(viewer.id).contacts.some((c) => c.id === target.id);
const lastLog = (w: World, r: Robot): string | undefined => w.scriptLogs.filter((l) => l.robot === r.id).at(-1)?.text;

describe('Sandbox rule: smoke and jammers do nothing', () => {
  it('is off by default, applies on the next tick, and a radar sees through a cloud while it is on', async () => {
    const w = await space0();
    expect(w.noSmokeOrJam).toBe(false);
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const target = w.spawnBlueprint(TARGET, { x: 40, y: 100 }, { team: 1 });
    const pod = w.spawnBlueprint(POD, { x: 20, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    w.step(key(pod, 's', true));
    w.step(key(pod, 's', false));
    expect(w.smokeClouds()).toHaveLength(1);
    expect(sees(w, me, target)).toBe(false);
    w.setNoSmokeOrJam(true);
    // Asked for, not applied yet: the getter says what the next tick runs with.
    expect(w.noSmokeOrJam).toBe(true);
    w.step();
    expect(sees(w, me, target)).toBe(true);
    // The cloud is still there, still drifting and running down.
    const [c] = w.smokeClouds();
    expect(c?.left).toBeLessThan(c?.total ?? 0);
    // Off again: the cloud blocks as before.
    w.setNoSmokeOrJam(false);
    w.step();
    expect(sees(w, me, target)).toBe(false);
    w.dispose();
  });

  it('a sensor inside a cloud sees, and a robot inside one is seen, with scan() of it in a script', async () => {
    const w = await space0();
    w.setNoSmokeOrJam(true);
    const me = w.spawnBlueprint({ ...POD_RADAR, scripts: [{ id: 'look', source: LOOK }] }, { x: 0, y: 100 });
    const watcher = w.spawnBlueprint({ ...RADAR, scripts: [{ id: 'look', source: LOOK }] }, { x: -30, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    w.step(key(me, 's', true));
    expect(w.smokeClouds()).toHaveLength(1);
    for (let i = 0; i < 3; i++) w.step();
    expect(sees(w, me, watcher)).toBe(true);
    expect(sees(w, watcher, me)).toBe(true);
    expect(lastLog(w, me)).toBe(`${watcher.id} true`);
    expect(lastLog(w, watcher)).toBe(`${me.id} true`);
    w.dispose();
  });

  it('a lit jammer blinds nothing: a robot inside its bubble is seen, and a sensor inside sees far', async () => {
    const w = await space0();
    w.setNoSmokeOrJam(true);
    const eye = w.spawnBlueprint({ ...RADAR, scripts: [{ id: 'look', source: LOOK }] }, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(JAM_BOT, { x: 200, y: 100 }, { team: 1 });
    const inner = w.spawnBlueprint(JAM_RADAR, { x: 400, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    w.step([...key(pod, 'v', true), ...key(inner, 'v', true)]);
    w.step([...key(pod, 'v', false), ...key(inner, 'v', false)]);
    // Both still light and say so.
    expect(w.partOutput(pod.id, 'jammer@0,2', 'jamming')).toBe(1);
    expect(w.partOutput(inner.id, 'jammer@0,0', 'jamming')).toBe(1);
    expect(w.events.filter((e) => e.kind === 'jamStarted')).toHaveLength(2);
    // 200 m off, past the 150 m a jam is seen through at: seen anyway, from outside and from inside.
    expect(sees(w, eye, pod)).toBe(true);
    expect(sees(w, inner, pod)).toBe(true);
    expect(sees(w, inner, eye)).toBe(true);
    expect(lastLog(w, eye)).toBe(`${pod.id} true`);
    w.dispose();
  });

  it('with the rule off, the same jammers hide and blind as before', async () => {
    const w = await space0();
    const eye = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const pod = w.spawnBlueprint(JAM_BOT, { x: 200, y: 100 }, { team: 1 });
    const inner = w.spawnBlueprint(JAM_RADAR, { x: 400, y: 100 }, { team: 1 });
    for (let i = 0; i < 5; i++) w.step();
    w.step([...key(pod, 'v', true), ...key(inner, 'v', true)]);
    w.step([...key(pod, 'v', false), ...key(inner, 'v', false)]);
    expect(sees(w, eye, pod)).toBe(false);
    expect(sees(w, inner, eye)).toBe(false);
    w.dispose();
  });

  it('a laser through smoke burns in full', async () => {
    for (const on of [false, true]) {
      const w = await World.create({ seed: 1, gravityY: 0 }, space);
      if (on) w.setNoSmokeOrJam(true);
      const rig = w.spawnBlueprint(RIG, { x: 0, y: 100 });
      const plate = w.spawnBlueprint(PLATE, { x: 100, y: 100 });
      const a = w.spawnBlueprint(POD, { x: 30, y: 108 });
      const b = w.spawnBlueprint(POD, { x: 70, y: 108 });
      w.step([...key(a, 's', true), ...key(b, 's', true)]);
      expect(w.smokeClouds()).toHaveLength(2);
      w.step(key(rig, 'f', true));
      // 600 damage a second, one tick: 10, or a quarter of it through two clouds.
      expect(plate.parts.get('armorplate@0,0')?.health).toBeCloseTo(on ? 250 - 10 : 250 - 10 / 4, 6);
      expect(w.liveBeams()[0]).toMatchObject({ smoke: on ? 0 : 2 });
      w.dispose();
    }
  });

  it('is hashed only while on, and logged, so a replay through JSON matches', async () => {
    // On flat ground with gravity: a replay keeps the world file and seed, not a test's gravity.
    const run = async (turn: boolean): Promise<{ w: World; hashes: string[] }> => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      w.spawnBlueprint(RADAR, { x: 0, y: 0.5 });
      w.spawnBlueprint(TARGET, { x: 40, y: 0.5 }, { team: 1 });
      const pod = w.spawnBlueprint(POD, { x: 20, y: 0.5 }, { team: 1 });
      const hashes: string[] = [];
      for (let i = 0; i < 30; i++) {
        if (turn && i === 10) w.setNoSmokeOrJam(true);
        if (turn && i === 20) w.setNoSmokeOrJam(false);
        // Asked for and taken back before the tick: nothing changes, nothing is logged.
        if (turn && i === 25) {
          w.setNoSmokeOrJam(true);
          w.setNoSmokeOrJam(false);
        }
        w.step(i === 5 ? key(pod, 's', true) : []);
        hashes.push(w.hash());
      }
      return { w, hashes };
    };
    const plain = await run(false);
    const turned = await run(true);
    // Before the switch, and the tick it is asked for but not stepped yet, the same as a world that never had it.
    expect(turned.hashes.slice(0, 10)).toEqual(plain.hashes.slice(0, 10));
    expect(turned.hashes[10]).not.toBe(plain.hashes[10]);
    expect(turned.w.inputLog.toJSON().filter((e) => e.world).map((e) => [e.tick, e.world])).toEqual([
      [10, { noSmokeOrJam: true }],
      [20, { noSmokeOrJam: false }],
    ]);
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(turned.w))));
    const r = await runReplay(replay, undefined, host);
    expect(r.matches).toBe(true);
    expect(r.hash).toBe(turned.w.hash());
    r.world.dispose();
    plain.w.dispose();
    turned.w.dispose();
  });

  it('replays without the field still load, and a wrong value is refused', () => {
    const ok = { format: 1, world: space, seed: 1, spawns: [], inputs: [{ tick: 0, inputs: [], world: { unlimitedEnergy: true } }], endTick: 0, endHash: 'x' };
    expect(parseReplay(ok).inputs[0]?.world).toEqual({ unlimitedEnergy: true });
    expect(() => parseReplay({ ...ok, inputs: [{ tick: 0, inputs: [], world: { noSmokeOrJam: 1 } }] })).toThrow('inputs[0].world.noSmokeOrJam must be true or false');
  });
});
