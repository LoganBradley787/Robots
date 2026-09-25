import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { sees } from '../src/sensors/sight';
import { parsePartDef, PartDefError } from '../src/parts/parsePartDef';
import { defaultRegistry } from '../src/parts/registry';
import { orientRaw } from '../src/blueprint/orient';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const reg = defaultRegistry();

/** No gravity, a small ground far below, and a wall at x 50 from y 90 to 110. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [{ x: 50, y: 100, w: 2, h: 20 }] });
const RADAR = { format: 1, name: 'radar-bot', grid: ['C  O  B'] };
const SEEKER_RIGHT = { format: 1, name: 'seeker-bot', grid: ['B  C  S>'] };
const TARGET = { format: 1, name: 'target', grid: ['C  B'] };
const DEBRIS = { format: 1, name: 'debris', grid: ['F  F'] };

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}

describe('sight (M8)', () => {
  const s = { id: 's', x: 0, y: 0, facing: 0, cone: 90, range: 100 };
  it('range and cone', () => {
    expect(sees(s, { x: 99, y: 0 }, [])).toBe(true);
    expect(sees(s, { x: 101, y: 0 }, [])).toBe(false);
    expect(sees(s, { x: 50, y: 49 }, [])).toBe(true);
    expect(sees(s, { x: 50, y: 51 }, [])).toBe(false);
    expect(sees(s, { x: -10, y: 0 }, [])).toBe(false);
    expect(sees({ ...s, cone: 360 }, { x: -10, y: 0 }, [])).toBe(true);
  });

  it('a terrain box in between hides the point', () => {
    const box = { x: 20, y: 0, hx: 1, hy: 5, angle: 0 };
    expect(sees(s, { x: 40, y: 0 }, [box])).toBe(false);
    expect(sees(s, { x: 40, y: 20 }, [box])).toBe(true);
  });
});

describe('sensor parts (M8)', () => {
  it('parse: a cone narrower than 360 needs acts, and cones over 360 are refused', () => {
    const base = { id: 'eye', name: 'Eye', footprint: [{ x: 0, y: 0, faces: ['S'] }], mass: 1, health: 1, symmetry: 1, inputs: [], outputs: [], powerDraw: 0, sprite: { frame: 'part.eye' } };
    expect(parsePartDef({ ...base, acts: 'N', sensor: { cone: 60, range: 10 } }, 'eye.json').sensor).toEqual({ cone: 60, range: 10 });
    expect(() => parsePartDef({ ...base, sensor: { cone: 60, range: 10 } }, 'eye.json')).toThrow(PartDefError);
    expect(() => parsePartDef({ ...base, sensor: { cone: 400, range: 10 } }, 'eye.json')).toThrow('360');
    expect(() => parsePartDef({ ...base, sensor: { cone: 360, range: 0 } }, 'eye.json')).toThrow(PartDefError);
  });

  it('a radar sees robots in range all around, with sides relative to its own team', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const enemy = w.spawnBlueprint(TARGET, { x: -100, y: 100 }, { team: 1 });
    const friend = w.spawnBlueprint(TARGET, { x: 0, y: 200 });
    const far = w.spawnBlueprint(TARGET, { x: -600, y: 100 }, { team: 1 });
    const junk = w.spawnBlueprint(DEBRIS, { x: 0, y: 60 });
    w.step();
    const seen = w.sensorView(me.id).contacts;
    expect(seen.map((c) => [c.id, c.side])).toEqual([
      [junk.id, 'none'],
      [enemy.id, 'enemy'],
      [friend.id, 'friend'],
    ]);
    expect(seen.some((c) => c.id === far.id)).toBe(false);
    w.dispose();
  });

  it('a wall hides a robot; another robot in between does not', async () => {
    const w = await world();
    const me = w.spawnBlueprint(RADAR, { x: 0, y: 100 });
    const hidden = w.spawnBlueprint(TARGET, { x: 100, y: 100 }, { team: 1 });
    const blocker = w.spawnBlueprint(DEBRIS, { x: -50, y: 100 });
    const behind = w.spawnBlueprint(TARGET, { x: -100, y: 100 }, { team: 1 });
    w.step();
    const ids = w.sensorView(me.id).contacts.map((c) => c.id);
    expect(ids).toContain(blocker.id);
    expect(ids).toContain(behind.id);
    expect(ids).not.toContain(hidden.id);
    w.dispose();
  });

  it('a seeker sees only inside its cone, and its cone turns with it', async () => {
    const w = await world();
    const right = w.spawnBlueprint(SEEKER_RIGHT, { x: 0, y: 100 });
    const left = w.spawnBlueprint(orientRaw(SEEKER_RIGHT, { flip: true }, reg), { x: 0, y: 130 });
    const a = w.spawnBlueprint(TARGET, { x: 40, y: 115 }, { team: 1 });
    const b = w.spawnBlueprint(TARGET, { x: -40, y: 115 }, { team: 1 });
    w.step();
    expect(w.sensorView(right.id).contacts.map((c) => c.id)).toEqual([a.id]);
    expect(w.sensorView(left.id).contacts.map((c) => c.id)).toEqual([b.id]);
    expect(w.sensorView(right.id).sensors[0]).toMatchObject({ id: 'seeker@2,0', cone: 90, range: 300 });
    w.dispose();
  });

  it('switched off or without energy, a sensor sees nothing; on, it draws its power', async () => {
    const w = await world();
    const off = w.spawnBlueprint(
      { ...RADAR, name: 'off', scripts: [{ id: 'off', source: "function tick() { set('radar', 'on', 0); }" }] },
      { x: 0, y: 100 },
    );
    const flat = w.spawnBlueprint({ format: 1, name: 'flat', grid: ['C  O'] }, { x: 0, y: 130 });
    // Cores hold energy too: empty this one.
    const core = flat.parts.get('core@0,0');
    if (core) core.stored = 0;
    const on = w.spawnBlueprint(RADAR, { x: 0, y: 160 });
    w.spawnBlueprint(TARGET, { x: 30, y: 100 }, { team: 1 });
    for (let i = 0; i < 60; i++) w.step();
    expect(w.sensorView(off.id).contacts).toEqual([]);
    expect(w.sensorView(flat.id).contacts).toEqual([]);
    expect(w.sensorView(on.id).contacts.length).toBe(3);
    expect(w.energy(on.id)?.used).toBeCloseTo(3, 5);
    expect(w.energy(off.id)?.used).toBe(0);
    w.dispose();
  });

  it('scripts get contacts nearest first, and scan() a seen robot part by part (4 calls a tick)', async () => {
    const w = await world();
    const src = `
      function tick() {
        if (frame !== 2) return;
        var c = contacts[0];
        log(contacts.length, c.side, c.core, c.parts, Math.round(c.distance), c.by.join(','), Math.round(c.mass * 10) / 10);
        var parts = scan(c.id);
        log(parts.map(function (p) { return p.type + ':' + p.health + '/' + p.maxHealth; }).join(' '));
        log(scan(9999), scan(c.id) !== null, scan(c.id) !== null, scan(c.id));
      }`;
    const me = w.spawnBlueprint({ ...RADAR, scripts: [{ id: 'look', source: src }] }, { x: 0, y: 100 });
    w.spawnBlueprint(TARGET, { x: 0, y: 70 }, { team: 1 });
    w.spawnBlueprint(TARGET, { x: 0, y: 140 }, { team: 1 });
    for (let i = 0; i < 4; i++) w.step();
    const logs = w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text);
    // The cap's warning is logged when the fifth call happens, before the line that made it.
    expect(logs).toEqual(['2 enemy true 2 30 radar@1,0 5', 'core:50/50 battery:30/30', 'scan(): at most 4 calls per tick; this one returned null', 'null true true null']);
    w.dispose();
  });

  it('is deterministic, and sensor power is in the hash', async () => {
    const run = async (on: number): Promise<string> => {
      const w = await world();
      w.spawnBlueprint({ ...RADAR, scripts: [{ id: 's', source: `function tick() { set('radar', 'on', ${on}); }` }] }, { x: 0, y: 100 });
      w.spawnBlueprint(TARGET, { x: 30, y: 100 }, { team: 1 });
      for (let i = 0; i < 30; i++) w.step();
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run(1)).toBe(await run(1));
    expect(await run(1)).not.toBe(await run(0));
  });
});
