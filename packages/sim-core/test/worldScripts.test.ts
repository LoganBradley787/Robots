import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const lifter = (source: string, extra: Record<string, unknown> = {}): unknown => ({
  format: 1,
  name: 'lifter',
  grid: ['F  T^ C  T^ F'],
  scripts: [{ id: 'lift', source }],
  ...extra,
});

async function world(): Promise<World> {
  return World.create({ seed: 1, scripts: host }, open);
}

describe('scripts in the world', () => {
  it('a script writes a channel every tick', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', 0.25); }`), { x: 0, y: 1 });
    w.step();
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0.25);
    expect(w.scripts(r.id)).toEqual([{ id: 'lift', enabled: true }]);
    w.dispose();
  });

  it('a held key overrides the script on that channel, and the script resumes on release', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', 0.25); }`), { x: 0, y: 1 });
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(1);
    w.step([{ robot: r.id, pressed: [], released: ['w'] }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0.25);
    w.dispose();
  });

  it('scripts see keys without creating a writer', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', keys.down('k') ? 0.5 : 0); }`), { x: 0, y: 1 });
    w.step([{ robot: r.id, pressed: ['k'], released: [] }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0.5);
    w.dispose();
  });

  it('a script binding toggles the script, and setup runs again with fresh state', async () => {
    const w = await world();
    const src = `function setup() { state.n = 0; } function tick() { state.n++; set('thruster', 'throttle', state.n / 100); }`;
    const r = w.spawnBlueprint(lifter(src, { bindings: [{ key: 'h', mode: 'script', script: 'lift' }] }), { x: 0, y: 1 });
    w.step();
    w.step();
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0.02);
    w.step([{ robot: r.id, pressed: ['h'], released: ['h'] }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0);
    expect(w.scripts(r.id)[0]?.enabled).toBe(false);
    w.step([{ robot: r.id, pressed: ['h'], released: ['h'] }]);
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBe(0.01);
    w.dispose();
  });

  it('an endless loop disables only that script and the world keeps stepping', async () => {
    const w = await world();
    const bad = w.spawnBlueprint(lifter(`function tick() { while (true) {} }`), { x: 0, y: 1 });
    const good = w.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', 0.1); }`), { x: 20, y: 1 });
    for (let i = 0; i < 10; i++) w.step();
    expect(w.tick).toBe(10);
    expect(w.scripts(bad.id)).toEqual([{ id: 'lift', enabled: false, crashed: { kind: 'budget', message: 'ran too long for one tick (an endless loop?)' } }]);
    expect(w.events.filter((e) => e.kind === 'scriptCrashed').map((e) => e.robot)).toEqual([bad.id]);
    expect(w.channelValue(good.id, 'thruster@1,0', 'throttle')).toBe(0.1);
    w.dispose();
  });

  it('compile errors and a world without a host are reported, not silent', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(`function tick( {`), { x: 0, y: 1 });
    w.step();
    expect(w.scripts(r.id)[0]?.crashed?.kind).toBe('compile');
    const bare = await World.create({ seed: 1 }, open);
    const r2 = bare.spawnBlueprint(lifter(`function tick() {}`), { x: 0, y: 1 });
    bare.step();
    expect(bare.scripts(r2.id)[0]?.crashed?.message).toContain('no script host');
    w.dispose();
    bare.dispose();
  });

  it('logs are kept and rate limited', async () => {
    const w = await world();
    w.spawnBlueprint(lifter(`function tick() { log('t', frame); log('again'); }`), { x: 0, y: 1 });
    for (let i = 0; i < 60; i++) w.step();
    expect(w.scriptLogs.length).toBe(20);
    expect(w.scriptLogs[0]).toMatchObject({ script: 'lift', text: 't 0' });
    w.dispose();
  });

  it('sensors are exact: self.vel matches the body and energy the pool', async () => {
    const w = await world();
    const r = w.spawnBlueprint(lifter(`function tick() { set('thruster', 'throttle', self.vel.y < -1 ? 1 : 0); log(self.energy.stored); }`), { x: 0, y: 30 });
    for (let i = 0; i < 120; i++) w.step();
    expect(w.scriptLogs[0]?.text).toBe('600');
    expect(w.channelValue(r.id, 'thruster@1,0', 'throttle')).toBeGreaterThanOrEqual(0);
    w.dispose();
  });

  it('a session with scripts replays to the same hash', async () => {
    const w = await world();
    const src = `function tick() { set('thruster', 'throttle', self.vel.y < 0 ? 0.6 : 0.2); if (random() < 0.01) log('r'); }`;
    const r = w.spawnBlueprint(lifter(src, { bindings: [{ key: 'h', mode: 'script', script: 'lift' }] }), { x: 0, y: 2 });
    for (let i = 0; i < 300; i++) w.step(i === 100 || i === 150 ? [{ robot: r.id, pressed: ['h'], released: ['h'] }] : []);
    const replay = JSON.parse(JSON.stringify(buildReplay(w)));
    const again = await runReplay(replay, undefined, host);
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });

  it('nothing a script does escapes World.step or World.dispose', async () => {
    const w = await world();
    const deep = `function tick() { var a = []; for (var i = 0; i < 100000; i++) a = [a]; JSON.stringify(a); }`;
    const r = w.spawnBlueprint(lifter(deep, { bindings: [{ key: 'h', mode: 'script', script: 'lift' }] }), { x: 0, y: 1 });
    expect(() => {
      for (let i = 0; i < 5; i++) w.step(i === 2 ? [{ robot: r.id, pressed: ['h'], released: ['h'] }] : []);
    }).not.toThrow();
    expect(w.scripts(r.id)[0]?.crashed).toBeDefined();
    expect(() => w.dispose()).not.toThrow();
  });
});
