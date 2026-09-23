import { describe, expect, it } from 'vitest';
import { parseKeyTimeline, timelineInputs } from '../src/control/timeline';

describe('key timelines', () => {
  it('parses ranges and taps from text', () => {
    expect(parseKeyTimeline('d:0-3, a:3.5-4, w:5')).toEqual([
      { key: 'd', down: 0, up: 3 },
      { key: 'a', down: 3.5, up: 4 },
      { key: 'w', down: 5, up: 5 },
    ]);
  });

  it('parses JSON', () => {
    expect(parseKeyTimeline([{ key: 'd', down: 1, up: 2 }, { key: 'Space', down: 0 }])).toEqual([
      { key: 'Space', down: 0, up: 0 },
      { key: 'd', down: 1, up: 2 },
    ]);
  });

  it('gives actionable errors', () => {
    expect(() => parseKeyTimeline('d:3-1')).toThrow('the end (1 s) is before the start (3 s)');
    expect(() => parseKeyTimeline('d')).toThrow("'d' is not key:start-end");
    expect(() => parseKeyTimeline('')).toThrow('empty');
    expect(() => parseKeyTimeline('d:0-3, d:2-4')).toThrow("key 'd' is pressed at 2 s while it is still held until 3 s");
    expect(() => parseKeyTimeline({})).toThrow('must be a list');
  });

  it('turns presses into per-tick edges', () => {
    const m = timelineInputs(parseKeyTimeline('d:0-1, w:0.5'), 7, 1 / 60);
    expect(m.get(0)).toEqual({ robot: 7, pressed: ['d'], released: [] });
    expect(m.get(30)).toEqual({ robot: 7, pressed: ['w'], released: ['w'] });
    expect(m.get(60)).toEqual({ robot: 7, pressed: [], released: ['d'] });
  });
});
