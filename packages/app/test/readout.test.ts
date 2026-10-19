import { describe, expect, it } from 'vitest';
import type { ControlTrace, TraceInput } from '@robots/sim-core';
import { buildReadout, percentOf, type ReadoutSource } from '../src/world/readout';

const types: Record<string, string> = { 'propeller@-2,0': 'propeller', 'propeller@2,0': 'propeller', 'gyro@0,1': 'gyro', 'gun@0,2': 'gun' };
const base = (over: Partial<ReadoutSource>): ReadoutSource => ({ robot: 'flyer', watching: false, scripts: [], logs: [], typeOf: (id) => types[id], typeName: (t) => t, ...over });
const throttle = (part: string, over: Partial<TraceInput>): TraceInput => ({ part, channel: 'throttle', min: 0, max: 1, default: 0, value: 0, source: 'default', keys: [], ...over });
const W = { key: 'w', mode: 'hold' as const, value: 1 };

describe('the live readout', () => {
  it('says each script running, off, or stopped with the message and the line', () => {
    const r = buildReadout(
      base({
        scripts: [{ id: 'hover', enabled: true }, { id: 'aim', enabled: false }, { id: 'guide', enabled: false, crashed: { kind: 'throw', message: "TypeError: cannot read property 'x' of undefined (line 42)" } }],
        logs: [
          { script: 'hover', text: 'one' },
          { script: 'guide', text: 'lost it' },
          { script: 'hover', text: 'two' },
        ],
      }),
    );
    expect(r.scripts).toEqual([
      { id: 'hover', state: 'on', logs: ['one', 'two'], sets: [] },
      { id: 'aim', state: 'off', logs: [], sets: [] },
      { id: 'guide', state: 'crashed', error: "TypeError: cannot read property 'x' of undefined", line: 42, logs: ['lost it'], sets: [] },
    ]);
    expect(r.inputs).toEqual([]);
  });

  it('says the keys each running script reads, and each held one plainly, folded by who reads it', () => {
    const scripts = [
      { id: 'hover', enabled: true, reads: ['w', 's', 'a', 'd'] },
      { id: 'aim', enabled: true, reads: ['f', 'w', 'j'] },
      { id: 'old', enabled: false, reads: ['q'] },
    ];
    const held = (keys: string[]) => (k: string) => keys.includes(k);
    const r = buildReadout(base({ scripts, held: held(['d', 'w', 'a', 'q']) }));
    expect(r.scripts.map((s) => s.reads)).toEqual(['reads W A S D', 'reads W F J', undefined]);
    expect(r.held).toEqual(['W is held: hover and aim read it.', 'A and D are held: hover reads them.']);
    expect(buildReadout(base({ scripts, held: held([]) })).held).toEqual([]);
    // Only watched: no keys of yours reach it, so none is said to be held.
    expect(buildReadout(base({ scripts, watching: true })).held).toEqual([]);
  });

  it('keeps only the last few log lines of each script', () => {
    const logs = Array.from({ length: 9 }, (_, i) => ({ script: 'hover', text: `line ${i}` }));
    expect(buildReadout(base({ scripts: [{ id: 'hover', enabled: true }], logs })).scripts[0]?.logs).toEqual(['line 5', 'line 6', 'line 7', 'line 8']);
  });

  it('what each script set this tick: writes to single parts folded by kind, named ones one each, a dead name said', () => {
    const trace: ControlTrace = {
      writes: [
        { script: 'hover', target: 'propeller@-2,0', channel: 'throttle', value: 0.52, parts: 1 },
        { script: 'hover', target: 'propeller@2,0', channel: 'throttle', value: 0.56, parts: 1 },
        { script: 'hover', target: 'gyro@0,1', channel: 'spin', value: -0.25, parts: 1 },
        { script: 'aim', target: 'turret', channel: 'turn', value: 1, parts: 2 },
        { script: 'aim', target: 'lfit', channel: 'throttle', value: 1, parts: 0 },
        { script: 'aim', target: 'gyro', channel: 'spin', value: 0, parts: 1 },
      ],
      inputs: [],
    };
    const r = buildReadout(base({ scripts: [{ id: 'hover', enabled: true }, { id: 'aim', enabled: true }], trace }));
    expect(r.scripts[0]?.sets).toEqual([{ text: 'throttle on 2 propellers: 0.52 to 0.56' }, { text: 'spin on gyro: -0.25' }]);
    expect(r.scripts[1]?.sets).toEqual([{ text: 'turn on "turret" (2 parts): 1' }, { text: 'throttle on "lfit": nothing answers to that name', bad: true }, { text: 'spin on "gyro" (1 part): 0' }]);
  });

  it('a script drives an input: one line for parts driven the same way, with the spread of their values', () => {
    const trace: ControlTrace = {
      writes: [],
      inputs: [throttle('propeller@-2,0', { value: 0.52, source: 'script', script: { id: 'hover', value: 0.52 } }), throttle('propeller@2,0', { value: 0.56, source: 'script', script: { id: 'hover', value: 0.56 } })],
    };
    expect(buildReadout(base({ trace })).inputs).toEqual([{ what: '2 propellers, throttle', says: 'hover sets it: 52% to 56%.', source: 'script' }]);
  });

  it('a held key beats the script, and both values are said', () => {
    const held = (part: string): TraceInput => throttle(part, { value: 1, source: 'key', keys: [{ ...W, active: true }], script: { id: 'hover', value: 0.54 } });
    const r = buildReadout(base({ trace: { writes: [], inputs: [held('propeller@-2,0'), held('propeller@2,0')] } }));
    expect(r.inputs).toEqual([{ what: '2 propellers, throttle', says: "W is held: the key's 100% beats hover's 54%.", source: 'key' }]);
  });

  it('a key with no script under it, two keys at once, a toggle, and a key that is not held', () => {
    const spin = (over: Partial<TraceInput>): TraceInput => ({ part: 'gyro@0,1', channel: 'spin', min: -1, max: 1, default: 0, value: 0, source: 'default', keys: [], ...over });
    const says = (i: TraceInput): string => buildReadout(base({ trace: { writes: [], inputs: [i] } })).inputs[0]?.says ?? '';
    expect(says(throttle('propeller@2,0', { value: 1, source: 'key', keys: [{ ...W, active: true }] }))).toBe('W is held: 100%.');
    expect(says(spin({ value: 0, source: 'key', keys: [{ key: 'q', mode: 'hold', value: 1, active: true }, { key: 'e', mode: 'hold', value: -1, active: true }] }))).toBe('Q and E are held: 0%.');
    expect(says(spin({ value: -0.5, source: 'key', keys: [{ key: 't', mode: 'toggle', value: -0.5, active: true }], script: { id: 'level', value: 0.2 } }))).toBe("T is switched on: the key's -50% beats level's 20%.");
    expect(says(throttle('propeller@2,0', { value: 0.54, source: 'script', keys: [{ ...W, active: false }], script: { id: 'hover', value: 0.54 } }))).toBe('hover sets it: 54%. W would take over.');
    expect(says(throttle('propeller@2,0', { keys: [{ ...W, active: false }] }))).toBe('Nothing drives it now: it rests at 0%. W would take over.');
  });

  it('two lines that would read the same name their parts instead', () => {
    const trace: ControlTrace = {
      writes: [],
      inputs: [throttle('propeller@-2,0', { value: 0.4, source: 'script', script: { id: 'hover', value: 0.4 } }), throttle('propeller@2,0', { value: 1, source: 'key', keys: [{ ...W, active: true }], script: { id: 'hover', value: 0.4 } })],
    };
    expect(buildReadout(base({ trace })).inputs.map((i) => i.what)).toEqual(['propeller@2,0, throttle', 'propeller@-2,0, throttle']);
  });

  it('puts what a key drives first, then scripts, then what rests; and says who is watched', () => {
    const trace: ControlTrace = {
      writes: [],
      inputs: [throttle('gun@0,2', { channel: 'fire', keys: [{ key: 'f', mode: 'hold', value: 1, active: false }] }), throttle('propeller@2,0', { value: 0.5, source: 'script', script: { id: 'hover', value: 0.5 } }), throttle('propeller@-2,0', { value: 1, source: 'key', keys: [{ ...W, active: true }] })],
    };
    const r = buildReadout(base({ watching: true, trace }));
    expect(r.inputs.map((i) => i.source)).toEqual(['key', 'script', 'default']);
    expect(r).toMatchObject({ robot: 'flyer', watching: true });
  });

  it('percent is of the input\'s full swing', () => {
    expect(percentOf(0.54, { min: 0, max: 1 })).toBe('54%');
    expect(percentOf(-1, { min: -1, max: 1 })).toBe('-100%');
    expect(percentOf(1.57, { min: -3.14, max: 3.14 })).toBe('50%');
    expect(percentOf(3, { min: 0, max: 0 })).toBe('3');
  });

  it('says what its scripts cost a tick, while any runs', () => {
    expect(buildReadout(base({ scripts: [{ id: 'hover', enabled: true }], cost: 1.43 })).cost).toBe('scripts 1.4 ms a tick');
    expect(buildReadout(base({ scripts: [{ id: 'hover', enabled: true }] })).cost).toBeUndefined();
    expect(buildReadout(base({ scripts: [{ id: 'hover', enabled: false }], cost: 1.43 })).cost).toBeUndefined();
  });
});
