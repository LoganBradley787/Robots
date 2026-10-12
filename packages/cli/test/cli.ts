import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

/** Runs `pnpm sim <args>` as a process of its own, as a builder types it: the exit code and both streams. */
export function sim(...args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { cwd: CLI_DIR, encoding: 'utf8', env: { ...process.env, INIT_CWD: CLI_DIR } });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** A fresh folder outside the repository with these files in it (objects are written as json). Returns its path. */
export function draftFolder(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'robots-cli-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return dir;
}
