import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import hopperJson from '../../../blueprints/hopper.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { buildReplay, parseReplay, ReplayError, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);

async function session(): Promise<World> {
  const w = await World.create({ seed: 3 }, flat);
  const car = w.spawnBlueprint(carJson, { x: -20, y: 3 });
  for (let i = 0; i < 400; i++) {
    const inputs = i === 30 ? [{ robot: car.id, pressed: ['d'], released: [] }] : i === 200 ? [{ robot: car.id, pressed: [], released: ['d'] }] : [];
    w.step(inputs);
  }
  // A second robot mid-session; control moves to it and the car keeps nothing held.
  const hopper = w.spawnBlueprint(hopperJson, { x: 30, y: 3 });
  for (let i = 0; i < 200; i++) w.step(i === 10 ? [{ robot: hopper.id, pressed: ['w', 'a'], released: [] }] : i === 40 ? [{ robot: hopper.id, pressed: [], released: ['w'] }] : []);
  return w;
}

describe('replay files', () => {
  it('a saved session reruns to the same end hash, through JSON', async () => {
    const w = await session();
    const replay = buildReplay(w);
    expect(replay.endTick).toBe(600);
    expect(replay.spawns.map((s) => s.tick)).toEqual([0, 400]);
    const parsed = parseReplay(JSON.parse(JSON.stringify(replay)));
    const r = await runReplay(parsed);
    expect(r.hash).toBe(w.hash());
    expect(r.matches).toBe(true);
    r.world.dispose();
    w.dispose();
  });

  it('notices a replay that does not match', async () => {
    const w = await session();
    const replay = { ...buildReplay(w), endHash: '00000000' };
    const r = await runReplay(replay);
    expect(r.matches).toBe(false);
    r.world.dispose();
    w.dispose();
  });

  it('rejects malformed files with a path to the problem', () => {
    expect(() => parseReplay({ format: 2 })).toThrow(ReplayError);
    const ok = { format: 1, world: flat, seed: 1, spawns: [], inputs: [], endTick: 0, endHash: 'x' };
    expect(() => parseReplay({ ...ok, inputs: [{ tick: 1, inputs: [{ robot: 1, pressed: 'd', released: [] }] }] })).toThrow('inputs[0].inputs[0].pressed');
    expect(() => parseReplay({ ...ok, seed: -1 })).toThrow('seed');
    expect(parseReplay(ok).endTick).toBe(0);
  });
});
