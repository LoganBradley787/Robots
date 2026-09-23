import { describe, expect, it } from 'vitest';
import { InputLog, type InputFrame } from '../src/replay/InputLog';

const frame = (down: string[]): InputFrame => ({ sourceId: 'keyboard', down, pressed: [], released: [] });

describe('InputLog', () => {
  it('stores only ticks that had input', () => {
    const log = new InputLog();
    log.append(0, []);
    log.append(1, [frame(['a'])]);
    log.append(2, []);
    expect(log.length).toBe(1);
    expect(log.framesAt(1)).toEqual([frame(['a'])]);
    expect(log.framesAt(2)).toEqual([]);
  });

  it('returns copies so callers cannot mutate the log', () => {
    const log = new InputLog();
    const f = frame(['a']);
    log.append(3, [f]);
    f.down.push('b');
    const got = log.framesAt(3);
    expect(got[0]?.down).toEqual(['a']);
    got[0]?.down.push('c');
    expect(log.framesAt(3)[0]?.down).toEqual(['a']);
  });

  it('rejects ticks that do not increase', () => {
    const log = new InputLog();
    log.append(4, [frame(['a'])]);
    expect(() => log.append(4, [frame(['b'])])).toThrow('not after 4');
  });

  it('round-trips through JSON', () => {
    const log = new InputLog();
    log.append(5, [frame(['w']), { sourceId: 'ai', down: [], pressed: ['x'], released: [] }]);
    const copy = InputLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(copy.toJSON()).toEqual(log.toJSON());
  });
});
