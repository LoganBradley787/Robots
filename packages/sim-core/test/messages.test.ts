import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { buildReplay, runReplay } from '../src/replay/replayFile';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });

/** A pilot, then a decoupler releasing right, then a dart whose core has its own script, scoped `dart1`. */
function launcher(pilot: string, dart: string): unknown {
  return {
    format: 1,
    name: 'pad',
    grid: ['C  B  D>  a'],
    legend: { a: { part: 'core', tags: ['dart1'] } },
    primaryCore: 'core@0,0',
    scripts: [{ id: 'pilot', source: pilot }],
    cores: { 'core@3,0': { scope: 'dart1', scripts: [{ id: 'dart', source: dart }] } },
  };
}

const DART = `
  function setup() { log('setup', frame, JSON.stringify(inbox)); }
  function tick() { if (inbox.length > 0) log('tick', frame, inbox.length); mark(1, 2, 'here'); }`;

async function world(): Promise<World> {
  return World.create({ seed: 1, gravityY: 0, scripts: host }, space);
}

function logs(w: World, robot: number): string[] {
  return w.scriptLogs.filter((l) => l.robot === robot).map((l) => l.text);
}

describe('messages between cores (M8)', () => {
  it('a pilot hands a point to a placed core, which reads it in setup() when it wakes', async () => {
    const w = await world();
    const pilot = `
      function tick() {
        if (frame === 1) log(send('dart1', { x: 5, y: 7 }), send('nobody', 1), send('core@3,0', 'second'), send('core@0,0', 'self'));
        if (frame === 3) set('decoupler', 'fire', 1);
      }`;
    const pad = w.spawnBlueprint(launcher(pilot, DART), { x: 0, y: 100 });
    for (let i = 0; i < 6; i++) w.step();
    expect(logs(w, pad.id)).toEqual(['true false true false']);
    const dart = w.robots.find((r) => r.brokeFrom === pad.id) as Robot;
    expect(dart.woke).toBe(true);
    // Woke on tick 3, scripts from tick 4: both messages, in send order, and gone after that tick.
    expect(logs(w, dart.id)).toEqual(['setup 4 [{"from":"core@0,0","tick":1,"data":{"x":5,"y":7}},{"from":"core@0,0","tick":1,"data":"second"}]', 'tick 4 2']);
    expect(dart.parts.get('core@3,0')?.inbox).toBeUndefined();
    expect(w.marks(dart.id)).toEqual([{ x: 1, y: 2, label: 'here' }]);
    w.dispose();
  });

  it('a message sent on a tick is shown on the next one; a detached core cannot be reached', async () => {
    const w = await world();
    const pilot = `
      function tick() {
        if (frame === 0) set('decoupler', 'fire', 1);
        if (frame === 2) log('after release', send('dart1', 1));
      }`;
    const pad = w.spawnBlueprint(launcher(pilot, DART), { x: 0, y: 100 });
    for (let i = 0; i < 4; i++) w.step();
    expect(logs(w, pad.id)).toEqual(['after release false']);
    w.dispose();
  });

  it('messages are capped at 1 KB each and 16 waiting, and they are state: hashed and replayed', async () => {
    // Normal gravity: replays do not record a test world's gravity.
    const w = await World.create({ seed: 1, scripts: host }, space);
    const pilot = `
      function tick() {
        if (frame === 0) {
          var big = ''; for (var i = 0; i < 1100; i++) big += 'x';
          log(send('dart1', big));
          for (var j = 0; j < 20; j++) send('dart1', j);
        }
      }`;
    const pad = w.spawnBlueprint(launcher(pilot, DART), { x: 0, y: 100 });
    w.step();
    expect(logs(w, pad.id)).toEqual(['false']);
    // 16 send calls a tick at most, the refused big one included (counted before its data is turned into text, so a
    // toJSON cannot send more): 0 to 14 arrive.
    expect(pad.parts.get('core@3,0')?.inbox?.map((m) => m.data)).toEqual(Array.from({ length: 15 }, (_, i) => String(i)));
    const again = await World.create({ seed: 1, scripts: host }, space);
    const quiet = again.spawnBlueprint(launcher('function tick() {}', DART), { x: 0, y: 100 });
    again.step();
    expect(quiet.parts.get('core@3,0')?.inbox).toBeUndefined();
    expect(w.hash()).not.toBe(again.hash());
    for (let i = 0; i < 10; i++) w.step();
    const r = await runReplay(buildReplay(w), undefined, host);
    expect(r.matches).toBe(true);
    r.world.dispose();
    again.dispose();
    w.dispose();
  });

  it('a toJSON cannot get past the send cap, and a robot sends at most 32 a tick in all (M8 review)', async () => {
    const w = await World.create({ seed: 1, scripts: host }, space);
    const pilot = `
      function tick() {
        if (frame !== 0) return;
        var n = 0;
        var sneaky = { toJSON: function () { if (n++ < 200) send('dart1', 'inner'); return 'outer'; } };
        send('dart1', sneaky);
      }`;
    const pad = w.spawnBlueprint(launcher(pilot, DART), { x: 0, y: 100 });
    w.step();
    expect(pad.parts.get('core@3,0')?.inbox?.length ?? 0).toBeLessThanOrEqual(16);
    w.dispose();
  });

  it('mark() and set() with NaN are skipped, not a crash (M8 review)', async () => {
    const w = await World.create({ seed: 1, scripts: host }, space);
    const pad = w.spawnBlueprint(launcher("function tick() { mark(NaN, 1); mark(1 / 0, 2); mark(3, 4); set('thruster', 'throttle', 0 / 0); }", DART), { x: 0, y: 100 });
    w.step();
    w.step();
    expect(w.events.some((e) => e.kind === 'scriptCrashed')).toBe(false);
    expect(w.marks(pad.id)).toEqual([{ x: 3, y: 4 }]);
    expect(logs(w, pad.id)[0]).toContain('not a number');
    w.dispose();
  });
});
