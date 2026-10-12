import { describe, expect, it } from 'vitest';
import { DULL_AT, EAR_HEIGHT, HALF_GAIN_AT, PAN_WIDTH, SOUND_SPEED, hear, type Ear } from '../src/audio/listener';
import { OneShotLimiter } from '../src/audio/limiter';
import { DEFAULT_SOUND, loadSoundSettings, saveSoundSettings } from '../src/audio/soundSettings';
import { ShotWatcher } from '../src/audio/ShotWatcher';
import { LOOP_DRIVES, loopGain, meanLevel, partLevel, pickLoops, type LoopGroup } from '../src/audio/loopLevels';

const ear: Ear = { x: 100, y: 10, zoom: 1, halfWidth: 30 };

describe('the ear (M15)', () => {
  it('a sound at the camera is still the ear height away', () => {
    const h = hear(ear, 100, 10);
    expect(h.distance).toBeCloseTo(EAR_HEIGHT);
    expect(h.pan).toBe(0);
    expect(h.gain).toBeCloseTo(HALF_GAIN_AT / (HALF_GAIN_AT + EAR_HEIGHT));
    expect(h.delay).toBeCloseTo(EAR_HEIGHT / SOUND_SPEED);
  });

  it('farther is quieter, duller and later', () => {
    const near = hear(ear, 110, 10);
    const far = hear(ear, 400, 10);
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(far.delay).toBeGreaterThan(near.delay);
    expect(far.delay).toBeCloseTo(Math.hypot(300, EAR_HEIGHT) / SOUND_SPEED);
    expect(hear(ear, 100 + DULL_AT, 10).cutoff).toBeLessThan(10500);
  });

  it('zooming out lifts the ear', () => {
    const out = hear({ ...ear, zoom: 0.05 }, 100, 10);
    expect(out.distance).toBeCloseTo(EAR_HEIGHT / 0.05);
    expect(out.gain).toBeLessThan(0.1);
  });

  it('pans by where it is on screen, never past the edge', () => {
    expect(hear(ear, 115, 10).pan).toBeCloseTo(0.5 * PAN_WIDTH);
    expect(hear(ear, 70, 10).pan).toBeCloseTo(-PAN_WIDTH);
    expect(hear(ear, 900, 10).pan).toBeCloseTo(PAN_WIDTH);
    expect(hear({ ...ear, halfWidth: 0 }, 900, 10).pan).toBe(0);
  });
});

describe('the one-shot limiter (M15)', () => {
  const opts = { maxLive: 5, maxMust: 2, perWindow: 2, windowSeconds: 0.05, floor: 0.01 };

  it('takes the loudest of one name in a window, and more once the window has passed', () => {
    const l = new OneShotLimiter(opts);
    const asks = [0.2, 0.9, 0.5].map((gain) => ({ name: 'gun', gain, seconds: 0.1 }));
    expect(l.pick(asks, 1).map((a) => a.gain)).toEqual([0.9, 0.5]);
    expect(l.pick(asks, 1.02)).toEqual([]);
    expect(l.pick(asks, 1.06).map((a) => a.gain)).toEqual([0.9, 0.5]);
  });

  it('counts each name on its own', () => {
    const l = new OneShotLimiter(opts);
    const got = l.pick([{ name: 'gun', gain: 0.5, seconds: 0.1 }, { name: 'gun', gain: 0.4, seconds: 0.1 }, { name: 'gun', gain: 0.3, seconds: 0.1 }, { name: 'hit', gain: 0.1, seconds: 0.1 }], 0);
    expect(got.map((a) => `${a.name} ${a.gain}`)).toEqual(['gun 0.5', 'gun 0.4', 'hit 0.1']);
  });

  it('drops what would not be heard', () => {
    expect(new OneShotLimiter(opts).pick([{ name: 'gun', gain: 0.005, seconds: 1 }], 0)).toEqual([]);
  });

  it('never has more sounding than the cap, and frees a voice when one ends', () => {
    const l = new OneShotLimiter(opts);
    const asks = ['a', 'b', 'c', 'd'].flatMap((name) => [{ name, gain: 0.5, seconds: 1 }, { name, gain: 0.4, seconds: 1 }]);
    expect(l.pick(asks, 0).length).toBe(5);
    expect(l.live).toBe(5);
    expect(l.pick(asks, 0.5).length).toBe(0);
    expect(l.pick(asks, 1.01).length).toBe(5);
    l.clear();
    expect(l.live).toBe(0);
  });
});

describe('the one-shot limiter: blasts have their own voices (M15)', () => {
  const opts = { maxLive: 2, maxMust: 3, perWindow: 2, windowSeconds: 0.05, floor: 0.01 };

  it('plays a must ask with every voice taken, but still at most its window of them', () => {
    const l = new OneShotLimiter(opts);
    expect(l.pick([{ name: 'gun', gain: 0.9, seconds: 1 }, { name: 'hit', gain: 0.8, seconds: 1 }], 0).length).toBe(2);
    const blasts = [0.3, 0.2, 0.1].map((gain) => ({ name: 'explosion', gain, seconds: 1, must: true }));
    expect(l.pick([{ name: 'thud', gain: 0.9, seconds: 1 }, ...blasts], 0.01).map((a) => a.gain)).toEqual([0.3, 0.2]);
    // Too quiet to hear is still dropped.
    expect(l.pick([{ name: 'boom', gain: 0.001, seconds: 1, must: true }], 0.02)).toEqual([]);
  });

  it('a chain of blasts never takes the other sounds\' voices, and is capped itself', () => {
    const l = new OneShotLimiter(opts);
    const blast = { name: 'explosion', gain: 0.9, seconds: 2, must: true };
    let played = 0;
    for (let i = 0; i < 20; i++) played += l.pick([blast, blast, blast], i * 0.06).length;
    expect(played).toBe(3);
    expect(l.pick([{ name: 'gun', gain: 0.5, seconds: 0.1 }], 1.3).length).toBe(1);
    expect(l.live).toBe(4);
  });
});

describe('sound settings (M15)', () => {
  const store = (init?: string) => {
    const m = new Map<string, string>(init === undefined ? [] : [['robots.sound', init]]);
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('defaults with nothing saved, no storage, or junk', () => {
    expect(loadSoundSettings(undefined)).toEqual(DEFAULT_SOUND);
    expect(loadSoundSettings(store())).toEqual(DEFAULT_SOUND);
    expect(loadSoundSettings(store('not json'))).toEqual(DEFAULT_SOUND);
    expect(loadSoundSettings(store('{"muted":"yes","volume":7,"delay":1}'))).toEqual(DEFAULT_SOUND);
  });

  it('round trips', () => {
    const s = store();
    saveSoundSettings(s, { muted: true, volume: 0.25, delay: false });
    expect(loadSoundSettings(s)).toEqual({ muted: true, volume: 0.25, delay: false });
  });

  it('a store that throws does not', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSoundSettings(broken)).toEqual(DEFAULT_SOUND);
    expect(() => saveSoundSettings(broken, DEFAULT_SOUND)).not.toThrow();
  });
});

describe('the shot watcher (M15)', () => {
  it('reports each shell once', () => {
    const w = new ShotWatcher<{ n: number }>();
    const a = { n: 1 };
    const b = { n: 2 };
    expect(w.fresh([a])).toEqual([a]);
    expect(w.fresh([a, b])).toEqual([b]);
    expect(w.fresh([a, b])).toEqual([]);
  });

  it('skips shells already in flight', () => {
    const w = new ShotWatcher<{ n: number }>();
    const a = { n: 1 };
    w.skip([a]);
    expect(w.fresh([a])).toEqual([]);
  });
});

describe('loop levels (M15)', () => {
  const none = () => undefined;

  it('reads a propeller from its throttle and a wheel from its spin over its top speed', () => {
    const prop = { id: 'p', def: {} };
    expect(partLevel(LOOP_DRIVES.propeller ?? {}, prop, (c) => (c === 'throttle' ? 0.6 : undefined), none)).toBeCloseTo(0.6);
    const wheel = { id: 'w', def: { behaviorConfig: { maxSpeed: 50 } } };
    expect(partLevel(LOOP_DRIVES.wheel ?? {}, wheel, none, none, () => -25)).toBeCloseTo(0.5);
    expect(partLevel(LOOP_DRIVES.wheel ?? {}, wheel, none, none, () => 900)).toBe(1);
    expect(partLevel({ output: 'rpm', over: 'maxSpeed' }, wheel, none, (o) => (o === 'rpm' ? 10 : undefined))).toBeCloseTo(0.2);
  });

  it('is 0 for a part with nothing to read', () => {
    expect(partLevel(LOOP_DRIVES.thruster ?? {}, { id: 't', def: {} }, none, none)).toBe(0);
    expect(partLevel({ output: 'x', over: 'y' }, { id: 't', def: {} }, none, () => Number.NaN)).toBe(0);
  });

  it('four are twice one, and hundreds stop at 1', () => {
    expect(loopGain(0)).toBe(0);
    expect(loopGain(4)).toBeCloseTo(2 * loopGain(1));
    expect(loopGain(732)).toBe(1);
  });

  it('the mean is over the parts that are on', () => {
    expect(meanLevel({ sum: 1.5, on: 3 })).toBeCloseTo(0.5);
    expect(meanLevel({ sum: 0, on: 0 })).toBe(0);
  });

  it('gives voices to the loudest at the ear', () => {
    const g = (robot: number, sum: number, x: number): LoopGroup => ({ key: `${robot}:propeller`, robot, voice: 'propeller', sum, on: 1, x, y: 0 });
    const groups = [g(1, 1, 0), g(2, 1, 500), g(3, 4, 100), g(4, 0, 0)];
    const gain = (g: LoopGroup) => 20 / (20 + Math.abs(g.x));
    expect(pickLoops(groups, gain, 2).map((p) => p.robot)).toEqual([1, 3]);
    // The silent one never gets a voice, however many there are to give.
    expect(pickLoops(groups, gain, 12).map((p) => p.robot)).toEqual([1, 3, 2]);
  });
});
