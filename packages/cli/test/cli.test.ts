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
