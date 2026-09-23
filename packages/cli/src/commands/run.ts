import { World, type BodyState, type WorldFile } from '@robots/sim-core';

export interface RunOptions {
  seconds: number;
  seed: number;
  sampleEverySeconds?: number;
}

export interface RunSample {
  tick: number;
  time: number;
  box: BodyState;
  hash: string;
}

export interface RunReport {
  world: string;
  seconds: number;
  seed: number;
  ticks: number;
  finalHash: string;
  box: BodyState;
  samples: RunSample[];
}

/** Spawns the M0 test box at the world's spawn point and steps for the requested time. */
export async function runSim(file: WorldFile, opts: RunOptions): Promise<RunReport> {
  const world = await World.create({ seed: opts.seed }, file);
  const box = world.spawnBox(file.spawn.x, file.spawn.y);
  const ticks = Math.round(opts.seconds / world.dt);
  const every = Math.max(1, Math.round((opts.sampleEverySeconds ?? 1) / world.dt));
  const samples: RunSample[] = [];
  for (let i = 0; i < ticks; i++) {
    world.step();
    if (world.tick % every === 0) {
      samples.push({ tick: world.tick, time: world.time, box: world.physics.state(box), hash: world.hash() });
    }
  }
  const report: RunReport = {
    world: file.name,
    seconds: opts.seconds,
    seed: opts.seed,
    ticks,
    finalHash: world.hash(),
    box: world.physics.state(box),
    samples,
  };
  world.dispose();
  return report;
}
