import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { Controller } from '../src/control/controller';

/**
 * The trace (M16): an optional record of one robot's control layer for one tick, for the live readout. Off unless
 * asked for, exact when on, and never part of the run: the same world with and without it has the same hashes.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const HOLD = `function tick() { set('thruster', 'throttle', 0.25); }`;
const TRIM = `function tick() { set('thruster@1,0', 'throttle', 0.6); set('nothing', 'throttle', 1); }`;

const lifter = (scripts: { id: string; source: string; enabled?: boolean }[], extra: Record<string, unknown> = {}): unknown => ({
  format: 1,
  name: 'lifter',
  grid: ['F  T^ C  T^ F'],
  scripts,
  ...extra,
});

async function world(): Promise<World> {
  return World.create({ seed: 1, scripts: host }, open);
}

describe('the control trace', () => {
  it('is off by default: no trace is kept, and a controller records nothing', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD }]), { x: 0, y: 1 });
    w.step();
    expect(w.trace(r.id)).toBeUndefined();
    expect(w.controller(r.id)?.traced).toBe(false);
    expect(w.controller(r.id)?.trace()).toBeUndefined();
    w.dispose();
  });

  it('says what each script set this tick and which one decided each input', async () => {
    const w = await world();
    const r = w.spawnBlueprint(
      lifter([
        { id: 'hold', source: HOLD },
        { id: 'trim', source: TRIM },
      ]),
      { x: 0, y: 1 },
    );
    w.setTrace(r.id);
    w.step();
    const t = w.trace(r.id);
    expect(t?.tick).toBe(0);
    // Every set(), in the order made, with how many parts it reached: a name that reaches nothing shows as 0.
    expect(t?.writes).toEqual([
      { script: 'hold', target: 'thruster', channel: 'throttle', value: 0.25, parts: 2 },
      { script: 'trim', target: 'thruster@1,0', channel: 'throttle', value: 0.6, parts: 1 },
      { script: 'trim', target: 'nothing', channel: 'throttle', value: 1, parts: 0 },
    ]);
    const input = (part: string) => t?.inputs.find((i) => i.part === part && i.channel === 'throttle');
    // The last write wins: trim on one thruster, hold on the other. W is bound (an auto key) and not held.
    expect(input('thruster@1,0')).toMatchObject({ source: 'script', value: 0.6, script: { id: 'trim', value: 0.6 } });
    expect(input('thruster@3,0')).toMatchObject({ source: 'script', value: 0.25, script: { id: 'hold', value: 0.25 } });
    expect(input('thruster@3,0')?.keys).toEqual([{ key: 'w', mode: 'hold', value: 1, active: false }]);
    // The trace agrees with what the parts got.
    for (const i of t?.inputs ?? []) expect(i.value).toBe(w.channelValue(r.id, i.part, i.channel));
    w.dispose();
  });

  it('a held key beats the script, and the trace says both values', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD }]), { x: 0, y: 1 });
    w.setTrace(r.id);
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    const held = w.trace(r.id)?.inputs.find((i) => i.part === 'thruster@1,0');
    expect(held).toMatchObject({ source: 'key', value: 1, script: { id: 'hold', value: 0.25 } });
    expect(held?.keys).toEqual([{ key: 'w', mode: 'hold', value: 1, active: true }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(1);
    w.step([{ robot: r.id, pressed: [], released: ['w'] }]);
    expect(w.trace(r.id)?.inputs.find((i) => i.part === 'thruster@1,0')).toMatchObject({ source: 'script', value: 0.25 });
    w.dispose();
  });

  it('an input a key is bound to and nobody writes reads as its default', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD, enabled: false }]), { x: 0, y: 1 });
    w.setTrace(r.id);
    w.step();
    const t = w.trace(r.id);
    expect(t?.writes).toEqual([]);
    expect(t?.inputs.find((i) => i.part === 'thruster@1,0')).toMatchObject({ source: 'default', value: 0, default: 0 });
    expect(t?.inputs.find((i) => i.part === 'thruster@1,0')?.script).toBeUndefined();
    w.dispose();
  });

  it('changes nothing: the same run with the trace on has the same hash every tick', async () => {
    const run = async (traced: boolean): Promise<string[]> => {
      const w = await world();
      const r = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD }, { id: 'trim', source: TRIM }]), { x: 0, y: 1 });
      if (traced) w.setTrace(r.id);
      const hashes: string[] = [];
      for (let i = 0; i < 90; i++) {
        w.step(i === 20 ? [{ robot: r.id, pressed: ['w'], released: [] }] : i === 50 ? [{ robot: r.id, pressed: [], released: ['w'] }] : []);
        hashes.push(w.hash());
      }
      w.dispose();
      return hashes;
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it('switching it off stops the record, and another robot can be traced instead', async () => {
    const w = await world();
    const a = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD }]), { x: 0, y: 1 });
    const b = w.spawnBlueprint(lifter([{ id: 'hold', source: HOLD }]), { x: 20, y: 1 });
    w.setTrace(a.id);
    w.step();
    expect(w.trace(a.id)?.writes).toHaveLength(1);
    expect(w.trace(b.id)).toBeUndefined();
    w.setTrace(b.id);
    expect(w.trace(a.id)).toBeUndefined();
    expect(w.controller(a.id)?.traced).toBe(false);
    w.step();
    expect(w.trace(b.id)?.writes).toHaveLength(1);
    w.setTrace(undefined);
    w.step();
    expect(w.trace(b.id)).toBeUndefined();
    expect(w.controller(b.id)?.traced).toBe(false);
    w.dispose();
  });
});

describe('a controller traces by itself', () => {
  const parts = [
    { id: 'a', part: 'wheel', tags: ['a', 'drive'], inputs: [{ name: 'speed', min: -1, max: 1, default: 0 }] },
    { id: 'b', part: 'wheel', tags: ['b', 'drive'], inputs: [{ name: 'speed', min: -1, max: 1, default: 0 }] },
  ];

  it('adds up the keys that write now, lists the ones that do not, and keeps the script it beat', () => {
    const c = new Controller(
      [
        { key: 'a', mode: 'hold', target: 'drive', channel: 'speed', value: -1 },
        { key: 'd', mode: 'hold', target: 'drive', channel: 'speed', value: 1 },
        { key: 't', mode: 'toggle', target: 'a', channel: 'speed', value: 0.5 },
      ],
      parts,
    );
    c.setTrace(true);
    c.apply(['d', 't'], []);
    c.scriptWrite('drive', 'speed', 0.2, 'cruise');
    const t = c.trace();
    const a = t?.inputs.find((i) => i.part === 'a');
    // D (+1) and the toggle (+0.5) add up to 1.5, held to the range: 1.
    expect(a).toMatchObject({ source: 'key', value: 1, script: { id: 'cruise', value: 0.2 } });
    expect(a?.keys.map((k) => `${k.key}:${k.active}`)).toEqual(['a:false', 'd:true', 't:true']);
    expect(t?.inputs.find((i) => i.part === 'b')).toMatchObject({ source: 'key', value: 1 });
    expect(c.values().get('a')?.get('speed')).toBe(1);
    // The next tick starts clean.
    c.endTick();
    expect(c.trace()?.writes).toEqual([]);
  });
});
