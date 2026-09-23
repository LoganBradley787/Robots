import { DriveTracker, parseReplay, runReplay, sampleRobot, type DriveMetrics } from '@robots/sim-core';
import { energyOf, formatDrive, formatEnergy, type RunReport } from './run';

export interface ReplayReport {
  ticks: number;
  hash: string;
  expected: string;
  matches: boolean;
  robots: { id: number; name: string; drive: DriveMetrics; energy: RunReport['energy'] }[];
}

/** Reruns a replay saved from the app, tracking every robot's drive metrics from its spawn. */
export async function replayCommand(raw: unknown): Promise<ReplayReport> {
  const replay = parseReplay(raw);
  const trackers = new Map<number, DriveTracker>();
  const r = await runReplay(replay, (world) => {
    for (const robot of world.robots) {
      let t = trackers.get(robot.id);
      if (!t) trackers.set(robot.id, (t = new DriveTracker()));
      t.add(sampleRobot(world, robot));
    }
  });
  try {
    return {
      ticks: r.world.tick,
      hash: r.hash,
      expected: replay.endHash,
      matches: r.matches,
      robots: r.world.robots.map((robot) => ({ id: robot.id, name: robot.name, drive: (trackers.get(robot.id) ?? new DriveTracker()).result(), energy: energyOf(r.world, robot.id) })),
    };
  } finally {
    r.world.dispose();
  }
}

export function formatReplay(r: ReplayReport): string {
  const lines = r.robots.flatMap((x) => [`robot ${x.id} ${x.name}: ${formatDrive(x.drive).replace(/^drive: /, '')}`, `  ${formatEnergy(x.energy)}`]);
  lines.push(`ticks=${r.ticks} (${(r.ticks / 60).toFixed(2)} s)  hash=${r.hash}  saved=${r.expected}`);
  lines.push(r.matches ? 'MATCH: the replay reproduces the saved run exactly' : 'MISMATCH: the replay did not end where the saved run did');
  return lines.join('\n');
}
