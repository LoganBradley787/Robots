import { InputLog, type LoggedTick } from './InputLog';
import { parseWorldFile, type WorldFile } from '../world/WorldFile';
import { World, type SpawnRecord } from '../world/World';

/**
 * Everything needed to rerun a session exactly (`11`, Replays): the world, the seed, every spawn, every key edge,
 * and the tick and hash it ended on, so a rerun can prove it matched.
 */
export interface ReplayFile {
  format: 1;
  world: WorldFile;
  seed: number;
  spawns: SpawnRecord[];
  inputs: LoggedTick[];
  endTick: number;
  endHash: string;
}

export class ReplayError extends Error {}

/** Captures the world as it is now. Robots cleared by a reset are not in it: a reset makes a new World. */
export function buildReplay(world: World): ReplayFile {
  return {
    format: 1,
    world: world.file,
    seed: world.seed,
    spawns: world.spawnLog.map((s) => ({ tick: s.tick, name: s.name, at: { ...s.at }, blueprint: s.blueprint })),
    inputs: world.inputLog.toJSON(),
    endTick: world.tick,
    endHash: world.hash(),
  };
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ReplayError(`${path} must be an object`);
  return v as Record<string, unknown>;
}

function int(v: unknown, path: string): number {
  if (!Number.isInteger(v) || (v as number) < 0) throw new ReplayError(`${path} must be a whole number, 0 or more`);
  return v as number;
}

function strings(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ReplayError(`${path} must be a list of key names`);
  return v as string[];
}

/** Checks a replay file's shape. Blueprints are validated when they are spawned. */
export function parseReplay(raw: unknown): ReplayFile {
  const r = obj(raw, 'replay');
  if (r.format !== 1) throw new ReplayError(`replay format must be 1, got ${JSON.stringify(r.format)}`);
  let world: WorldFile;
  try {
    world = parseWorldFile(r.world);
  } catch (e) {
    throw new ReplayError(`replay world: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(r.spawns)) throw new ReplayError('replay spawns must be a list');
  if (!Array.isArray(r.inputs)) throw new ReplayError('replay inputs must be a list');
  const spawns: SpawnRecord[] = r.spawns.map((s, i) => {
    const o = obj(s, `spawns[${i}]`);
    const at = obj(o.at, `spawns[${i}].at`);
    if (typeof at.x !== 'number' || typeof at.y !== 'number') throw new ReplayError(`spawns[${i}].at needs numbers x and y`);
    return { tick: int(o.tick, `spawns[${i}].tick`), name: String(o.name ?? ''), at: { x: at.x, y: at.y }, blueprint: o.blueprint };
  });
  const inputs: LoggedTick[] = r.inputs.map((t, i) => {
    const o = obj(t, `inputs[${i}]`);
    if (!Array.isArray(o.inputs)) throw new ReplayError(`inputs[${i}].inputs must be a list`);
    return {
      tick: int(o.tick, `inputs[${i}].tick`),
      inputs: o.inputs.map((x, j) => {
        const e = obj(x, `inputs[${i}].inputs[${j}]`);
        return { robot: int(e.robot, `inputs[${i}].inputs[${j}].robot`), pressed: strings(e.pressed, `inputs[${i}].inputs[${j}].pressed`), released: strings(e.released, `inputs[${i}].inputs[${j}].released`) };
      }),
    };
  });
  if (typeof r.endHash !== 'string') throw new ReplayError('replay endHash must be a string');
  const seed = int(r.seed, 'seed');
  return { format: 1, world, seed, spawns, inputs, endTick: int(r.endTick, 'endTick'), endHash: r.endHash };
}

/**
 * Reruns a replay in a fresh world: spawns land before the tick they were made on, inputs go into their tick.
 * `onTick` sees the world after every step (metrics). The caller disposes the returned world.
 */
export async function runReplay(replay: ReplayFile, onTick?: (world: World) => void): Promise<{ world: World; hash: string; matches: boolean }> {
  const world = await World.create({ seed: replay.seed }, replay.world);
  const log = InputLog.fromJSON(replay.inputs);
  const spawns = [...replay.spawns];
  let next = 0;
  while (world.tick < replay.endTick) {
    while (next < spawns.length && (spawns[next]?.tick ?? Infinity) <= world.tick) {
      const s = spawns[next++];
      if (s) world.spawnBlueprint(s.blueprint, s.at);
    }
    world.step(log.inputsAt(world.tick));
    onTick?.(world);
  }
  // Spawns made after the last tick (dropped while paused at the end) still belong to the end state.
  while (next < spawns.length) {
    const s = spawns[next++];
    if (s) world.spawnBlueprint(s.blueprint, s.at);
  }
  const hash = world.hash();
  return { world, hash, matches: hash === replay.endHash };
}
