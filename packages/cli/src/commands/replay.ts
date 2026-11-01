import { DriveTracker, parseReplay, runReplay, sampleRobot, type DriveMetrics, type ReplayFile } from '@robots/sim-core';
import { REPO_ROOT } from '../blueprintFiles';
import { gitBuild, type GitBuild } from '../gitBuild';
import { scriptHost } from '../scriptHost';
import { energyOf, formatDrive, formatEnergy, type RunReport } from './run';

export interface ReplayReport {
  ticks: number;
  hash: string;
  expected: string;
  matches: boolean;
  /** The build the replay says made it, and this checkout's. */
  saved: GitBuild;
  here: GitBuild;
  robots: { id: number; name: string; drive: DriveMetrics; energy: RunReport['energy'] }[];
}

/** Reruns a replay saved from the app, tracking every robot's drive metrics from its spawn. */
export async function replayCommand(raw: unknown, here: GitBuild = gitBuild(REPO_ROOT)): Promise<ReplayReport> {
  const replay = parseReplay(raw);
  const trackers = new Map<number, DriveTracker>();
  const r = await runReplay(
    replay,
    (world) => {
      for (const robot of world.robots) {
        let t = trackers.get(robot.id);
        if (!t) trackers.set(robot.id, (t = new DriveTracker()));
        t.add(sampleRobot(world, robot));
      }
    },
    await scriptHost(),
  );
  try {
    return {
      ticks: r.world.tick,
      hash: r.hash,
      expected: replay.endHash,
      matches: r.matches,
      saved: savedBuild(replay),
      here,
      robots: r.world.robots.map((robot) => ({ id: robot.id, name: robot.name, drive: (trackers.get(robot.id) ?? new DriveTracker()).result(), energy: energyOf(r.world, robot.id) })),
    };
  } finally {
    r.world.dispose();
  }
}

/** The build a replay records. */
export function savedBuild(replay: ReplayFile): GitBuild {
  return { ...(replay.commit === undefined ? {} : { commit: replay.commit }), ...(replay.dirty ? { dirty: true } : {}) };
}

const short = (commit: string): string => commit.slice(0, 12);

/** Which commit made a replay, and a warning when this checkout is not that build: a rerun there need not match. */
export function formatBuilds(saved: GitBuild, here: GitBuild): string[] {
  if (saved.commit === undefined) return ['commit unknown: the replay does not say which build made it'];
  const lines = [`made by commit ${short(saved.commit)}${saved.dirty ? ' with uncommitted changes' : ''}`];
  if (here.commit === undefined) lines.push('this checkout has no commit to compare it with');
  else if (here.commit !== saved.commit) lines.push(`WARNING: this checkout is at ${short(here.commit)}, another commit: the rerun may not end the same. Rerun it at ${short(saved.commit)} to be sure`);
  else if (saved.dirty) lines.push('WARNING: the same commit, but its uncommitted changes are not known here: the rerun may not end the same');
  if (here.dirty) lines.push('WARNING: this checkout has uncommitted changes: the rerun may not end the same');
  return lines;
}

export function formatReplay(r: ReplayReport): string {
  const lines = r.robots.flatMap((x) => [`robot ${x.id} ${x.name}: ${formatDrive(x.drive).replace(/^drive: /, '')}`, `  ${formatEnergy(x.energy)}`]);
  lines.push(...formatBuilds(r.saved, r.here));
  lines.push(`ticks=${r.ticks} (${(r.ticks / 60).toFixed(2)} s)  hash=${r.hash}  saved=${r.expected}`);
  lines.push(r.matches ? 'MATCH: the replay reproduces the saved run exactly' : 'MISMATCH: the replay did not end where the saved run did');
  return lines.join('\n');
}
