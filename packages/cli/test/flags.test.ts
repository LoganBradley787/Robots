import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/blueprintFiles';
import { COMMAND_FLAGS, flagProblem } from '../src/flags';
import { sim } from './cli';

describe('flagProblem (review T3)', () => {
  it('passes the flags a command reads, and --help anywhere', () => {
    expect(flagProblem('run', ['seconds', 'seed', 'x', 'y', 'keys', 'drop', 'json', 'unlimited', 'team', 'flip', 'rot', 'world'])).toBeUndefined();
    expect(flagProblem('determinism', ['seconds', 'keys', 'drop'])).toBeUndefined();
    expect(flagProblem('duel', ['ya', 'yb', 'seed', 'seconds', 'world', 'bounds', 'json'])).toBeUndefined();
    expect(flagProblem('validate', ['help'])).toBeUndefined();
    expect(flagProblem('validate', [])).toBeUndefined();
  });

  it('refuses a misspelled flag with the nearest real one', () => {
    expect(flagProblem('run', ['secnds'])).toBe('unknown flag --secnds; did you mean --seconds? (run takes --world, --seconds, --seed, --x, --y, --keys, --unlimited, --no-smoke-jam, --team, --flip, --rot, --drop, --json)');
    expect(flagProblem('run', ['seconds', 'sead'])).toContain('unknown flag --sead; did you mean --seed?');
    expect(flagProblem('tournament', ['sed'])).toContain('did you mean --seeds?');
    expect(flagProblem('run', ['banana'])).toMatch(/^unknown flag --banana \(run takes /);
  });

  it("refuses another command's flag", () => {
    expect(flagProblem('run', ['axis'])).toMatch(/^--axis is not a flag of run \(run takes /);
    expect(flagProblem('duel', ['y'])).toBe('--y is not a flag of duel (duel takes --ya, --yb, --seed, --seconds, --world, --bounds, --no-smoke-jam, --json)');
    expect(flagProblem('duel', ['bound'])).toMatch(/^unknown flag --bound; did you mean --bounds\? \(duel takes /);
    expect(flagProblem('validate', ['json'])).toBe('--json is not a flag of validate (validate takes no flags)');
    expect(flagProblem('determinism', ['json'])).toMatch(/^--json is not a flag of determinism/);
  });

  it('names a misspelled flag even when it swallowed the command', () => {
    expect(flagProblem('car', ['jsn'])).toBe('unknown flag --jsn; did you mean --json?');
    expect(flagProblem('car', ['json'])).toBeUndefined();
  });
});

/** Every `pnpm sim <command> ... --flag` in a text, as [command, flag] pairs. */
function documented(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(/pnpm sim ([a-z]+)([^`\n]*)/g)) for (const f of (m[2] ?? '').matchAll(/--([a-z][a-z-]*)/g)) out.push([m[1] ?? '', f[1] ?? '']);
  return out;
}

describe('the flag table', () => {
  it('has every flag the playbook, the design docs, the readmes and CI use', () => {
    const design = resolve(REPO_ROOT, 'docs/design');
    const files = ['README.md', 'CLAUDE.md', 'tournaments/README.md', 'docs/claude-robot-playbook.md', '.github/workflows/ci.yml', ...readdirSync(design).map((f) => `docs/design/${f}`)];
    const pairs = files.flatMap((f) => documented(readFileSync(resolve(REPO_ROOT, f), 'utf8')));
    expect(pairs.length).toBeGreaterThan(30);
    for (const [command, flag] of pairs) expect(flagProblem(command, [flag]), `pnpm sim ${command} --${flag}`).toBeUndefined();
  });

  it('has every flag the usage text lists', () => {
    const usage = sim('help').stdout;
    const all = new Set(Object.values(COMMAND_FLAGS).flat());
    const listed = [...usage.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1] ?? '');
    expect(listed.length).toBeGreaterThan(30);
    for (const f of listed) expect(all.has(f) || f === 'help', `--${f}`).toBe(true);
  });
});

describe('pnpm sim with a flag it does not read', () => {
  it('exits 2 with a hint and runs nothing', () => {
    const r = sim('run', 'car', '--secnds', '1', '--sead', '9');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag --secnds; did you mean --seconds?');
    expect(r.stdout).toBe('');
  });

  it('refuses --drop where nothing is dropped', () => {
    const r = sim('duel', 'car', 'car', '--drop', 'bomb@2:3,6');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--drop is not a flag of duel');
  });

  it('refuses a flag on a command that takes none', () => {
    expect(sim('validate', 'car', '--flip').code).toBe(2);
    expect(sim('tune', '--seconds', '3').code).toBe(2);
  });

  it('still runs with the flags it reads', () => {
    const r = sim('run', 'car', '--seconds', '1', '--seed', '9', '--x', '-100', '--y', '3', '--keys', 'd:0-1', '--drop', 'bomb@0.5:-90,6', '--json');
    expect(r.code).toBe(0);
    expect((JSON.parse(r.stdout) as { ticks: number }).ticks).toBe(60);
    expect(sim('validate', 'car', '--help').code).toBe(0);
  });
});
