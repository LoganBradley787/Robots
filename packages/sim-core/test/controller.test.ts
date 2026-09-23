import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import type { Binding } from '../src/blueprint/types';
import type { ControlledPart } from '../src/control/types';

const SPEED = [{ name: 'speed', min: -1, max: 1, default: 0 }];
const THROTTLE = [{ name: 'throttle', min: 0, max: 1, default: 0 }];
const parts: ControlledPart[] = [
  { id: 'wheel@0,0', part: 'wheel', tags: ['wheels', 'wheel@0,0'], inputs: SPEED },
  { id: 'wheel@4,0', part: 'wheel', tags: ['wheels', 'wheel@4,0'], inputs: SPEED },
  { id: 'thruster@2,0', part: 'thruster', tags: ['thruster@2,0', 'wheels'], inputs: THROTTLE },
  { id: 'frame@1,1', part: 'frame', tags: ['frame@1,1'], inputs: [] },
];
const hold = (key: string, target: string, channel: string, value: number): Binding => ({ key, mode: 'hold', target, channel, value });

function values(c: Controller): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, chans] of c.values()) out[id] = Object.fromEntries(chans);
  return out;
}

describe('Controller', () => {
  it('gives every channel its default with no writer', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    expect(values(c)).toEqual({ 'wheel@0,0': { speed: 0 }, 'wheel@4,0': { speed: 0 }, 'thruster@2,0': { throttle: 0 } });
  });

  it('hold writes while the key is down and stops on release', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    c.apply(['d'], []);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(1);
    c.endTick();
    expect(c.values().get('wheel@4,0')?.get('speed')).toBe(1);
    c.apply([], ['d']);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(0);
  });

  it('a tap (press and release in one tick) holds for that tick only', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    c.apply(['d'], ['d']);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(1);
    c.endTick();
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(0);
  });

  it('parts with the tag but without the channel are skipped', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    c.apply(['d'], []);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(0);
  });

  it('two holds on one channel sum and clamp: A and D together give 0', () => {
    const c = new Controller([hold('a', 'wheels', 'speed', -1), hold('d', 'wheels', 'speed', 1), hold('e', 'wheels', 'speed', 1)], parts);
    c.apply(['a', 'd'], []);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(0);
    c.apply([], ['a']);
    c.apply(['e'], []);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(1);
  });

  it('clamps to the channel range', () => {
    const c = new Controller([hold('w', 'thruster', 'throttle', 5), hold('s', 'thruster', 'throttle', -5)], parts);
    c.apply(['w'], []);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(1);
    c.apply(['s'], ['w']);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(0);
  });

  it('targets part types and part ids as implicit tags', () => {
    const c = new Controller([hold('w', 'thruster', 'throttle', 1), hold('k', 'wheel@4,0', 'speed', -1)], parts);
    c.apply(['w', 'k'], []);
    const v = values(c);
    expect(v['thruster@2,0']?.throttle).toBe(1);
    expect(v['wheel@4,0']?.speed).toBe(-1);
    expect(v['wheel@0,0']?.speed).toBe(0);
  });

  it('toggle flips on each press and ignores release', () => {
    const c = new Controller([{ key: 't', mode: 'toggle', target: 'thruster', channel: 'throttle', value: 1 }], parts);
    c.apply(['t'], []);
    c.apply([], ['t']);
    c.endTick();
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(1);
    expect(c.state()).toEqual({ held: [], toggles: [0] });
    c.apply(['t'], []);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(0);
  });

  it('pulse writes on the press tick only, even if the key stays down', () => {
    const c = new Controller([{ key: 'p', mode: 'pulse', target: 'thruster', channel: 'throttle', value: 1 }], parts);
    c.apply(['p'], []);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(1);
    c.endTick();
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(0);
    expect(c.state().held).toEqual(['p']);
  });

  it('pressing a key already held does not re-fire toggles', () => {
    const c = new Controller([{ key: 't', mode: 'toggle', target: 'thruster', channel: 'throttle', value: 1 }], parts);
    c.apply(['t'], []);
    c.endTick();
    c.apply(['t'], []);
    expect(c.state().toggles).toEqual([0]);
  });

  it('ignores unknown keys, releases of keys not held, and script bindings', () => {
    const c = new Controller([{ key: 'x', mode: 'script', script: 'hover' }, hold('d', 'wheels', 'speed', 1)], parts);
    c.apply(['q', 'x'], ['z']);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(0);
    expect(c.state()).toEqual({ held: ['q', 'x'], toggles: [] });
  });

  it('knows which keys it responds to, in binding order without repeats', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1), hold('a', 'wheels', 'speed', -1), hold('d', 'thruster', 'throttle', 1)], parts);
    expect(c.keys).toEqual(['d', 'a']);
  });

  it('state is sorted and stable', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    c.apply(['z', 'd', 'a'], []);
    expect(c.state().held).toEqual(['a', 'd', 'z']);
  });
});

describe('Controller script layer', () => {
  it('a script value applies when no key writes the channel; a held key wins over it', () => {
    const c = new Controller([hold('d', 'wheels', 'speed', 1)], parts);
    c.scriptWrite('wheels', 'speed', -0.5);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(-0.5);
    c.apply(['d'], []);
    c.scriptWrite('wheels', 'speed', -0.5);
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(1);
    c.endTick();
    expect(c.values().get('wheel@0,0')?.get('speed')).toBe(1); // still held; the script layer cleared
  });

  it('script values are clamped and cleared every tick', () => {
    const c = new Controller([], parts);
    c.scriptWrite('thruster', 'throttle', 7);
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(1);
    c.endTick();
    expect(c.values().get('thruster@2,0')?.get('throttle')).toBe(0);
  });

  it('script bindings toggle their script on press; key state lists pressed and released', () => {
    const c = new Controller([{ key: 'h', mode: 'script', script: 'hover' }], parts);
    c.apply(['h'], []);
    expect(c.takeScriptToggles()).toEqual(['hover']);
    expect(c.takeScriptToggles()).toEqual([]);
    expect(c.keyState()).toEqual({ down: ['h'], pressed: ['h'], released: [] });
    c.endTick();
    c.apply([], ['h']);
    expect(c.keyState()).toEqual({ down: [], pressed: [], released: ['h'] });
  });
});
