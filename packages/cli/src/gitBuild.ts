import { execFileSync } from 'node:child_process';

/** What a replay records of the build that made it (`11`, Replays). Empty away from git. */
export interface GitBuild {
  commit?: string;
  dirty?: boolean;
}

function git(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The commit `cwd` is on. Dirty means a tracked file differs from it: robots are inlined into replays, so the untracked
 * blueprints a checkout collects say nothing about the build. A tarball, or a machine without git, gives nothing.
 */
export function gitBuild(cwd: string): GitBuild {
  const commit = git(cwd, 'rev-parse', 'HEAD');
  if (commit === undefined) return {};
  return { commit, ...(git(cwd, 'status', '--porcelain', '--untracked-files=no') ? { dirty: true } : {}) };
}
