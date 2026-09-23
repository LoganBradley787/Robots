import { describe, expect, it } from 'vitest';
import { InputLog } from '../src/replay/InputLog';
import type { RobotInput } from '../src/control/types';

const press = (...keys: string[]): RobotInput => ({ robot: 1, pressed: keys, released: [] });

describe('InputLog', () => {
  it('stores only ticks that had key edges', () => {
    const log = new InputLog();
    log.append(0, []);
    log.append(1, [press('a')]);
    log.append(2, [{ robot: 1, pressed: [], released: [] }]);
    expect(log.length).toBe(1);
    expect(log.inputsAt(1)).toEqual([press('a')]);
    expect(log.inputsAt(2)).toEqual([]);
  });

  it('returns copies so callers cannot mutate the log', () => {
    const log = new InputLog();
    const i = press('a');
    log.append(3, [i]);
    i.pressed.push('b');
    const got = log.inputsAt(3);
    expect(got[0]?.pressed).toEqual(['a']);
    got[0]?.pressed.push('c');
    expect(log.inputsAt(3)[0]?.pressed).toEqual(['a']);
  });

  it('rejects ticks that do not increase', () => {
    const log = new InputLog();
    log.append(4, [press('a')]);
    expect(() => log.append(4, [press('b')])).toThrow('not after 4');
  });

  it('round-trips through JSON', () => {
    const log = new InputLog();
    log.append(5, [press('w'), { robot: 2, pressed: [], released: ['x'] }]);
    const copy = InputLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(copy.toJSON()).toEqual(log.toJSON());
  });
});
