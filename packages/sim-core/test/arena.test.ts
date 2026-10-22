import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { MATCH_ARENA } from '../src/world/arena';
import { buildReplay, parseReplay, ReplayError, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

// A core on a thruster: it says what `arena` is and tries to change it, then goes up only when there is an arena.
const rocket = {
  format: 1,
  name: 'rocket',
  grid: ['C', 'T^'],
  scripts: [
    {
      id: 'up',
      enabled: true,
      source: [
        "function setup() { log('arena ' + JSON.stringify(arena) + ' frozen ' + (arena === null || Object.isFrozen(arena))); arena = 5; log('after ' + JSON.stringify(arena)); }",
        "function tick() { set('thruster', 'throttle', arena && arena.y > 100 ? 1 : 0); }",
      ].join('\n'),
    },
  ],
};

async function run(arena: { x: number; y: number } | null | undefined): Promise<World> {
  const world = await World.create({ seed: 1, scripts: host, ...(arena !== undefined ? { arena } : {}) }, flat);
  world.spawnBlueprint(rocket, { x: 0, y: 3 });
  for (let i = 0; i < 60; i++) world.step();
  return world;
}

describe('arena', () => {
  it('is null for scripts in a world without one', async () => {
    const world = await run(undefined);
    expect(world.arena).toBeNull();
    expect(world.scriptLogs.map((l) => l.text)).toEqual(['arena null frozen true', 'after null']);
    world.dispose();
  });

  it('is the world option for scripts, frozen and not assignable; the world keeps a copy', async () => {
    const given = { ...MATCH_ARENA };
    const world = await run(given);
    expect(world.arena).toEqual({ x: 1000, y: 250 });
    expect(world.arena).not.toBe(given);
    expect(world.scriptLogs.map((l) => l.text)).toEqual(['arena {"x":1000,"y":250} frozen true', 'after {"x":1000,"y":250}']);
    world.dispose();
  });

  it('a script may still name its own top level variable arena', async () => {
    const world = await World.create({ seed: 1, scripts: host, arena: MATCH_ARENA }, flat);
    world.spawnBlueprint({ ...rocket, scripts: [{ id: 'own', enabled: true, source: "const arena = 3;\nfunction tick() { if (frame === 1) log('own ' + arena); }" }] }, { x: 0, y: 3 });
    for (let i = 0; i < 3; i++) world.step();
    expect(world.scriptLogs.map((l) => l.text)).toEqual(['own 3']);
    world.dispose();
  });

  it('refuses an arena that is not finite or has no width', async () => {
    await expect(World.create({ seed: 1, arena: { x: Number.POSITIVE_INFINITY, y: 250 } }, flat)).rejects.toThrow(/arena/);
    await expect(World.create({ seed: 1, arena: { x: 0, y: 250 } }, flat)).rejects.toThrow(/arena/);
  });

  it('a script that reads it behaves differently, and a replay carries it so the rerun matches', async () => {
    const withArena = await run(MATCH_ARENA);
    const without = await run(null);
    expect(withArena.hash()).not.toBe(without.hash());
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(withArena))));
    expect(replay.arena).toEqual({ x: 1000, y: 250 });
    const r = await runReplay(replay, undefined, host);
    expect(r.matches).toBe(true);
    expect(r.world.arena).toEqual({ x: 1000, y: 250 });
    r.world.dispose();
    // The same replay without its arena ends somewhere else.
    const { arena: _, ...bare } = replay;
    const r2 = await runReplay(bare, undefined, host);
    expect(r2.matches).toBe(false);
    r2.world.dispose();
    // No arena: none in the file.
    expect('arena' in buildReplay(without)).toBe(false);
    withArena.dispose();
    without.dispose();
  });

  it('a replay with a bad arena is refused; null reads as none', () => {
    const replay = { format: 1, world: flatJson, seed: 1, spawns: [], inputs: [], endTick: 0, endHash: '' };
    expect(() => parseReplay({ ...replay, arena: { x: 'far', y: 1 } })).toThrow(ReplayError);
    expect(parseReplay({ ...replay, arena: null }).arena).toBeUndefined();
  });
});
