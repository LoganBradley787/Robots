import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { draftFolder, sim } from './cli';

/** A car whose drive script names a file. */
const scripted = (file: string): unknown => ({ format: 1, name: 'x', grid: ['C  F  F', 'W  .  W'], scripts: [{ id: 'drive', source: { file }, enabled: true }] });

describe('a missing script file (review T1)', () => {
  const dir = draftFolder({ 'x.json': scripted('x.drive.js'), 'y.json': scripted('y.drive.js'), 'y.drive.js': "function tick() { set('wheel', 'speed', 1); }" });
  const broken = join(dir, 'x.json');
  const whole = join(dir, 'y.json');

  it.each([['validate'], ['show'], ['run'], ['determinism']])('is an error for %s, naming the file', (command) => {
    const r = sim(command, broken);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('error MISSING_SCRIPT: script file x.drive.js not found');
    expect(r.stderr).toContain(broken);
    expect(r.stdout).toBe('');
  });

  it('is an error for duel, whichever side it is on', () => {
    for (const args of [[broken, whole], [whole, broken]]) {
      const r = sim('duel', ...args, '--seconds', '1');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('error MISSING_SCRIPT: script file x.drive.js not found');
      expect(r.stdout).toBe('');
    }
  });

  it('leaves a blueprint with its script file alone', () => {
    const r = sim('validate', whole);
    expect(r).toEqual({ code: 0, stdout: 'ok\n', stderr: '' });
  });
});

describe('--save of a result that does not validate (review T4)', () => {
  // Its binding reaches a tag no part has, so the car, its mirror image, and anything placed on it all fail to validate.
  const bad = { format: 1, name: 'bad', grid: ['C  F  F', 'W  .  W'], bindings: [{ key: 'a', mode: 'hold', target: 'nope', channel: 'speed', value: 1 }] };
  const good = { format: 1, name: 'good', grid: ['C  F  F', 'W  .  W'] };
  const pod = { format: 1, name: 'pod', grid: ['F'] };

  it('mirror writes nothing and says why', () => {
    const dir = draftFolder({ 'bad.json': bad });
    const r = sim('mirror', join(dir, 'bad.json'), '--save', join(dir, 'out.json'));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('error BAD_TARGET');
    expect(r.stderr).toContain('not saved');
    expect(r.stdout).toBe('');
    expect(readdirSync(dir)).toEqual(['bad.json']);
  });

  it('place writes nothing and says why', () => {
    const dir = draftFolder({ 'bad.json': bad, 'pod.json': pod });
    const r = sim('place', join(dir, 'bad.json'), join(dir, 'pod.json'), '--at', '1,2', '--save', join(dir, 'out.json'));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('error BAD_TARGET');
    expect(r.stderr).toContain('not saved');
    expect(readdirSync(dir).sort()).toEqual(['bad.json', 'pod.json']);
  });

  it('still saves a result that validates', () => {
    const dir = draftFolder({ 'good.json': good, 'pod.json': pod });
    expect(sim('mirror', join(dir, 'good.json'), '--save', join(dir, 'flipped.json')).code).toBe(0);
    expect(sim('place', join(dir, 'good.json'), join(dir, 'pod.json'), '--at', '1,2', '--save', join(dir, 'podded.json')).code).toBe(0);
    expect(existsSync(join(dir, 'flipped.json'))).toBe(true);
    expect(existsSync(join(dir, 'podded.json'))).toBe(true);
  });
});
