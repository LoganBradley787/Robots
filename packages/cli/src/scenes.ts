import { defaultRegistry, orientRaw, parseKeyTimeline, parseWorldFile } from '@robots/sim-core';
import { DEFAULT_WORLD, readBlueprint, readJson, resolveBlueprint } from './blueprintFiles';
import { runSim, type RunOptions, type RunReport } from './commands/run';
import { parseDrop } from './drops';

/** A `pnpm sim run` written as data: the blueprint, where and how it is deployed, its keys, and what else drops in. */
export interface Scene {
  name: string;
  bp: string;
  seconds: number;
  x?: number;
  y?: number;
  keys?: string;
  team?: number;
  flip?: boolean;
  /** `--drop` values: `enemy-drone@0:-50,27:enemy:flip`. */
  drops?: string[];
}

/**
 * Scenes whose final hash must not change unless the sim is changed on purpose (M9): CI's determinism runs, plus
 * big robots, volleys, a battle between two teams, and a drone broken apart by a bomb (splits, and a missile waking
 * on a piece). `packages/cli/test/golden.test.ts` compares them with `golden-hashes.json`.
 */
export const GOLDEN_SCENES: readonly Scene[] = [
  { name: 'car', bp: 'car', seconds: 10 },
  { name: 'hopper', bp: 'hopper', seconds: 8, keys: 'd:0-3, w:1-1.3, a:4-6' },
  { name: 'drone', bp: 'drone', seconds: 10, keys: 'a:2-3, w:5-6, h:8' },
  { name: 'longcar-bomb', bp: 'longcar', x: -100, y: 1.5, seconds: 6, keys: 'd:0-6', drops: ['bomb@2:-77,4.95'] },
  { name: 'launcher', bp: 'launcher', x: -100, y: 1.5, seconds: 5, keys: 'f:2', drops: ['wall@0:-80,5.5'] },
  { name: 'missile-drone', bp: 'missile-drone', x: -100, y: 3, seconds: 12, keys: 'w:0.5-3.5, f:6, f:9' },
  { name: 'missile-drone-10prop', bp: 'missile-drone-10prop', x: -100, y: 3, seconds: 14, keys: 'w:0.5-3.5, d:4-6, a:7-8, f:10, f:12' },
  { name: 'launcher-seeker', bp: 'launcher-seeker', x: -100, y: 1.45, seconds: 6, keys: 'f:1', drops: ['missile-drone-10prop@0:-20,20:enemy'] },
  { name: 'launcher-arc', bp: 'launcher-arc', x: -100, y: 1.45, seconds: 8, keys: 'f:1', drops: ['car@0:-20,1:enemy'] },
  { name: 'hunter-duel', bp: 'hunter-drone', x: -130, y: 15, seconds: 20, keys: 'a:1-1.5, f:3, f:6, f:9', drops: ['enemy-drone@0:-50,27:enemy:flip'] },
  { name: 'flying-silo-volley', bp: 'flying-silo', x: -100, y: 0.5, seconds: 12, keys: 'w:1-3, f:5, f:5.5, f:6', drops: ['car@0:-40,1:enemy'] },
  { name: 'silo-volley', bp: 'silo', x: -100, y: 0.5, seconds: 14, keys: 'f:2, f:2.3, f:2.6, f:2.9, f:3.2, f:3.5', drops: ['enemy-drone@0:-30,25:enemy:flip', 'enemy-drone@0:10,30:enemy:flip'] },
  { name: 'battle-2v2', bp: 'enemy-drone', x: -80, y: 20, team: 1, seconds: 20, drops: ['enemy-drone@0:-110,25:enemy', 'enemy-drone@0:40,20:team2:flip', 'enemy-drone@0:70,25:team2:flip'] },
  { name: 'big-launcher', bp: 'big-launcher', x: -100, y: 1.5, seconds: 10, keys: 'f:1', drops: ['missile-drone-10prop@0:-30,20:enemy'] },
  { name: 'drone-bombed', bp: 'missile-drone-10prop', x: -100, y: 3, seconds: 8, keys: 'w:0.5-1.5, f:5', drops: ['bomb@2:-103,14'] },
  // M10: the new enemies, and arming (a hit on a loaded drone sets off only what hit it).
  { name: 'drone-bomb-vs-drone', bp: 'drone-bomb', x: -100, y: 3, seconds: 8, team: 1, drops: ['missile-drone-10prop@0:-30,20'] },
  { name: 'truck-vs-car', bp: 'enemy-truck', x: -100, y: 1.45, seconds: 26, team: 1, drops: ['car@0:-350,1.45'] },
  { name: 'enemy-big-drone-vs-hunter', bp: 'enemy-big-drone', x: -100, y: 1.55, seconds: 20, team: 1, drops: ['hunter-drone@0:-250,15'] },
  { name: 'enemy-carrier-vs-hunter', bp: 'enemy-carrier', x: -100, y: 1.55, seconds: 25, team: 1, drops: ['hunter-drone@0:-280,15'] },
  { name: 'enemy-flying-silo-vs-hunter', bp: 'enemy-flying-silo', x: -100, y: 1.5, seconds: 20, team: 1, drops: ['hunter-drone@0:-250,15'] },
  // M12: the fabricator bay builds missiles while it fires them at a row of cars.
  { name: 'fab-drone', bp: 'fab-drone', x: -100, y: 15, seconds: 16, keys: 'f:1-16', drops: ['car@0:-200,1.45:enemy', 'car@0:-230,1.45:enemy'] },
  // After M12: the enemy fab drone firing what it builds at parked cars, and a drone-bomb fabricator (F held) against
  // the enemy one.
  { name: 'enemy-fab-drone-vs-cars', bp: 'enemy-fab-drone', x: -60, y: 20, team: 1, seconds: 16, drops: ['car@0:-150,1.45', 'car@0:-175,1.45'] },
  { name: 'bomb-fab-drones', bp: 'bomb-fab-drone', x: -100, y: 15, seconds: 18, keys: 'f:1-18', drops: ['enemy-bomb-fab-drone@0:-190,25:enemy:flip'] },
  // M11: flares. The hunter pops a pair three times while the enemy flying silo fires at it (hunter-duel and the enemy
  // scenes above have the enemies popping their own).
  { name: 'hunter-flares', bp: 'hunter-drone', x: -250, y: 15, seconds: 12, keys: 'v:3.8, v:6, v:8.5', drops: ['enemy-flying-silo@0:-100,1.5:enemy'] },
];

/** Runs a scene on the default world, as `pnpm sim run` would. */
export async function runScene(s: Scene, world?: RunOptions['world']): Promise<RunReport> {
  const file = parseWorldFile(readJson(DEFAULT_WORLD));
  const loaded = readBlueprint(resolveBlueprint(s.bp));
  const blueprint = orientRaw(loaded.raw, { flip: s.flip === true }, defaultRegistry());
  return runSim(file, blueprint, {
    seconds: s.seconds,
    seed: 1,
    ...(s.x !== undefined || s.y !== undefined ? { at: { x: s.x ?? file.spawn.x, y: s.y ?? file.spawn.y } } : {}),
    ...(s.keys ? { keys: parseKeyTimeline(s.keys) } : {}),
    ...(s.team ? { team: s.team } : {}),
    ...(s.drops ? { drops: s.drops.map(parseDrop) } : {}),
    ...(world ? { world } : {}),
  });
}
