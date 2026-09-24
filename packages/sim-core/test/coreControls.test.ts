import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { buildReplay, runReplay } from '../src/replay/replayFile';
import { expandBlueprint } from '../src/blueprint/expand';
import { placeBlueprint } from '../src/blueprint/place';
import { toFileJson } from '../src/blueprint/serialize';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

function bp(raw: unknown): Blueprint {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

/** A "missile" with a gyro, its own key, and a script that spins it. */
const missile = bp({
  format: 1,
  name: 'missile',
  grid: ['C  G'],
  bindings: [{ key: 'k', mode: 'hold', target: 'gyro', channel: 'spin', value: 1 }],
  scripts: [{ id: 'spin', source: "function setup() { log('awake'); } function tick() { set('gyro', 'spin', -0.5); }" }],
});

/** A pilot core with a decoupler releasing right; the missile is placed on the decoupler's release face. */
function launcher(): unknown {
  const parent = bp({ format: 1, name: 'rail', grid: ['G  C  D>'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] });
  const r = placeBlueprint(parent, missile, { x: 3, y: 0 }, reg);
  if (!r.ok) throw new Error(r.error);
  return toFileJson(r.blueprint, reg, { inlineScripts: true });
}

describe('a woken core runs its own controls (M7)', () => {
  it('does nothing while attached, then wakes with its bindings and scripts', async () => {
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const r = w.spawnBlueprint(launcher(), { x: 0, y: 3 });
    // Attached: the pilot's controls only. The missile's key is not the pilot's, and its script is not running.
    expect(w.controller(r.id)?.keys).not.toContain('k');
    w.step([{ robot: r.id, pressed: ['k'], released: [] }]);
    expect(w.channelValue(r.id, 'gyro@4,0', 'spin')).toBe(0);
    expect(w.scripts(r.id)).toEqual([]);

    w.step([{ robot: r.id, pressed: ['f'], released: ['k'] }]);
    const piece = w.robots.find((x) => x.id !== r.id) as Robot;
    expect([...piece.parts.keys()]).toEqual(['core@3,0', 'gyro@4,0']);
    expect(piece.woke).toBe(true);
    expect(w.events.some((e) => e.kind === 'coreWoke' && e.robot === piece.id)).toBe(true);
    // Its auto controls (the gyro's E and Q) and its own key.
    expect(w.controller(piece.id)?.keys).toEqual(['e', 'q', 'k']);
    expect(w.scripts(piece.id)).toEqual([{ id: 'spin', enabled: true }]);

    w.step();
    expect(w.channelValue(piece.id, 'gyro@4,0', 'spin')).toBe(-0.5);
    expect(w.scriptLogs.some((l) => l.robot === piece.id && l.text === 'awake')).toBe(true);
    // Its key beats its script, like any manual input.
    w.step([{ robot: piece.id, pressed: ['k'], released: [] }]);
    expect(w.channelValue(piece.id, 'gyro@4,0', 'spin')).toBe(1);
    // The pilot's gyro was never the missile's `gyro`.
    expect(w.channelValue(r.id, 'gyro@0,0', 'spin')).toBe(0);
    w.dispose();
  });

  it('its scripts see their own tags without the scope, and part masses', async () => {
    const tagged = bp({
      format: 1,
      name: 'missile',
      grid: ['C  M'],
      legend: { M: { part: 'gyro', tags: ['stab'] } },
      scripts: [{ id: 'look', source: "function tick() { const g = parts.find((p) => p.type === 'gyro'); log(g.tags.join(' '), g.mass); }" }],
    });
    const parent = bp({ format: 1, name: 'rail', grid: ['C  D>'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] });
    const placed = placeBlueprint(parent, tagged, { x: 2, y: 0 }, reg);
    if (!placed.ok) throw new Error(placed.error);
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const r = w.spawnBlueprint(toFileJson(placed.blueprint, reg, { inlineScripts: true }), { x: 0, y: 3 });
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    w.step();
    expect(w.scriptLogs.map((l) => l.text)).toEqual(['gyro@3,0 stab 1']);
    w.dispose();
  });

  it('reaches a part placed by hand into the missile by its type', async () => {
    const parent = bp({ format: 1, name: 'rail', grid: ['C  D>'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] });
    const placed = placeBlueprint(parent, missile, { x: 2, y: 0 }, reg);
    if (!placed.ok) throw new Error(placed.error);
    // Replace the missile's gyro with a fresh one: it has none of the missile's tags.
    const parts = placed.blueprint.parts.map((p) => (p.id === 'gyro@3,0' ? { ...p, tags: ['gyro@3,0'] } : p));
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const r = w.spawnBlueprint(toFileJson({ ...placed.blueprint, parts }, reg, { inlineScripts: true }), { x: 0, y: 3 });
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    w.step();
    const piece = w.robots.find((x) => x.id !== r.id) as Robot;
    expect(w.channelValue(piece.id, 'gyro@3,0', 'spin')).toBe(-0.5);
    w.dispose();
  });

  it('a woken core with auto controls off in its own controls has only its bindings', async () => {
    const quiet = { ...missile, autoControls: false as const };
    const parent = bp({ format: 1, name: 'rail', grid: ['C  D>'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] });
    const placed = placeBlueprint(parent, quiet, { x: 2, y: 0 }, reg);
    if (!placed.ok) throw new Error(placed.error);
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const r = w.spawnBlueprint(toFileJson(placed.blueprint, reg, { inlineScripts: true }), { x: 0, y: 3 });
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    const piece = w.robots.find((x) => x.id !== r.id) as Robot;
    expect(w.controller(piece.id)?.keys).toEqual(['k']);
    w.dispose();
  });

  it('replays the same', async () => {
    // Replays keep the world file, not a custom gravity: this one sits on the ground.
    const w = await World.create({ seed: 1, scripts: host }, space);
    const r = w.spawnBlueprint(launcher(), { x: -2, y: 0.6 });
    for (let i = 0; i < 30; i++) w.step(i === 5 ? [{ robot: r.id, pressed: ['f'], released: [] }] : []);
    const piece = w.robots.find((x) => x.id !== r.id) as Robot;
    for (let i = 0; i < 30; i++) w.step(i === 3 ? [{ robot: piece.id, pressed: ['k'], released: [] }] : []);
    const replay = JSON.parse(JSON.stringify(buildReplay(w)));
    const again = await runReplay(replay, undefined, host);
    expect(again.matches).toBe(true);
    again.world.dispose();
    w.dispose();
  });
});
