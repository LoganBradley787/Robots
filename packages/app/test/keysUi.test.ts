import { describe, expect, it } from 'vitest';
import { autoBindings, defaultRegistry, expandBlueprint, toFileJson, type Binding, type Blueprint } from '@robots/sim-core';
import { WORLD_KEYS } from '../src/app/keys';
import { controlsOf, withControls } from '../src/builder/coreControls';
import { History } from '../src/builder/history';
import {
  autoUses,
  bindFromPart,
  bindingSentence,
  claimAuto,
  inputAutoKeys,
  inputBindings,
  KEYBOARD,
  keyLabel,
  keyOwners,
  MODE_WORDS,
  ownerKind,
  partScopes,
  reachOf,
  refusal,
  retarget,
  targetWords,
} from '../src/builder/keys';

const reg = defaultRegistry();
// Two propellers over a core, three wheels under it. The left wheel and the left propeller are in the group `left`.
const bp = expandBlueprint({
  format: 1,
  name: 't',
  grid: ['P C Q', 'L W W'],
  legend: { P: { part: 'propeller', tags: ['left'] }, Q: { part: 'propeller' }, L: { part: 'wheel', tags: ['left'] }, W: { part: 'wheel' } },
}).blueprint as Blueprint;
const main = (b: Blueprint) => controlsOf(b, reg, undefined);
const wheel = 'wheel@0,0';
const withKeys = (bindings: Binding[]): Blueprint => withControls(bp, reg, undefined, { bindings });

describe('binding from a part row', () => {
  it('offers this part, all parts of its kind, then its groups', () => {
    expect(partScopes(bp, reg, wheel)).toEqual([
      { kind: 'part', target: wheel, label: 'this part' },
      { kind: 'kind', target: 'wheel', label: 'all Wheels' },
      { kind: 'group', target: 'left', label: 'left' },
    ]);
    expect(partScopes(bp, reg, 'wheel@1,0').map((s) => s.kind)).toEqual(['part', 'kind']);
  });

  it('a new key drives that one part while held, at the full value of the input', () => {
    const next = bindFromPart(bp, reg, main(bp), 'k', wheel, 'speed');
    expect(next).toEqual([{ key: 'k', mode: 'hold', target: wheel, channel: 'speed', value: 1 }]);
    // An input the part does not have makes nothing.
    expect(bindFromPart(bp, reg, main(bp), 'k', wheel, 'throttle')).toBe(main(bp).bindings);
  });

  it('the scope moves the same binding: this part, every wheel, the group', () => {
    const one = withKeys([...bindFromPart(bp, reg, main(bp), 'k', wheel, 'speed')]);
    expect(reachOf(one, reg, wheel, 'speed')).toEqual([wheel]);
    expect(inputBindings(one, reg, main(one), wheel, 'speed').map((m) => m.scope.kind)).toEqual(['part']);
    // The other wheels are not driven by it yet.
    expect(inputBindings(one, reg, main(one), 'wheel@1,0', 'speed')).toEqual([]);

    const all = withKeys(retarget(one, reg, main(one), 0, 'wheel'));
    expect(main(all).bindings).toEqual([{ key: 'k', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }]);
    expect(reachOf(all, reg, 'wheel', 'speed')).toEqual(['wheel@0,0', 'wheel@1,0', 'wheel@2,0']);
    expect(inputBindings(all, reg, main(all), 'wheel@1,0', 'speed').map((m) => m.scope.kind)).toEqual(['kind']);

    const group = withKeys(retarget(all, reg, main(all), 0, 'left'));
    expect(main(group).bindings[0]).toMatchObject({ target: 'left', channel: 'speed', value: 1 });
    // The group holds a propeller too, but the key drives `speed`: only the part that has that input lights up.
    expect(reachOf(group, reg, 'left', 'speed')).toEqual([wheel]);
    expect(reachOf(group, reg, 'left', undefined)).toEqual(['propeller@0,1', wheel]);
    expect(inputBindings(group, reg, main(group), wheel, 'speed').map((m) => m.scope.kind)).toEqual(['group']);
  });

  it('a target without the input takes its first input, and the value stays inside its range', () => {
    const b = withKeys([{ key: 'k', mode: 'hold', target: 'wheel', channel: 'speed', value: -1 }]);
    expect(retarget(b, reg, main(b), 0, 'propeller')[0]).toEqual({ key: 'k', mode: 'hold', target: 'propeller', channel: 'throttle', value: 0 });
  });

  it('says the modes in plain words and keeps the file words', () => {
    expect(MODE_WORDS).toMatchObject({ hold: 'while held', toggle: 'on and off', pulse: 'tap once' });
    const b = withKeys([{ key: 'f', mode: 'pulse', target: 'wheel', channel: 'speed', value: 1 }]);
    expect(bindingSentence(b, reg, main(b).bindings[0] as Binding)).toBe('F, tap once: all Wheels, speed +100%');
    expect(JSON.stringify(toFileJson(b, reg))).toContain('"mode":"pulse"');
    expect(bindingSentence(bp, reg, { key: 'g', mode: 'toggle', target: 'left', channel: 'throttle', value: 0.5 })).toBe('G, on and off: group left, throttle 50%');
    expect(bindingSentence(bp, reg, { key: 'h', mode: 'script', script: 'hover' })).toBe('H: switches hover.js on and off');
    expect(targetWords(bp, reg, wheel)).toBe('the Wheel at 0, 0');
    expect(targetWords(bp, reg, 'gone')).toBe('gone (not on this robot)');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });

  it('refuses a world key with the reason', () => {
    expect(refusal('Space')).toBe('Space pauses the world, so it cannot drive the robot. Letters and digits are all yours.');
    expect(refusal('KeyF')).toBeUndefined();
    expect(refusal('ArrowUp')).toBeUndefined();
  });
});

describe('an auto key made yours', () => {
  it('shows the part its auto keys as rows until auto is off', () => {
    expect(inputAutoKeys(bp, reg, main(bp), wheel, 'speed').map((b) => [b.key, b.value])).toEqual([
      ['d', 1],
      ['a', -1],
    ]);
    const off = withControls(bp, reg, undefined, { autoOn: false });
    expect(inputAutoKeys(off, reg, main(off), wheel, 'speed')).toEqual([]);
  });

  it('turns auto off for that part and writes the same keys as bindings, in one undo step', () => {
    const history = new History(bp);
    const before = history.present;
    history.commit(claimAuto(before, reg, undefined, [wheel]));
    const after = history.present;
    expect(after.parts.find((p) => p.id === wheel)?.auto).toBe(false);
    expect(after.parts.filter((p) => p.auto === false).length).toBe(1);
    expect(after.bindings).toEqual([
      { key: 'd', mode: 'hold', target: wheel, channel: 'speed', value: 1 },
      { key: 'a', mode: 'hold', target: wheel, channel: 'speed', value: -1 },
    ]);
    // The robot drives exactly as it did: the same keys do the same things, counting auto and yours together.
    const all = (b: Blueprint): string[] => [...autoBindings(b, reg), ...b.bindings].map((x) => JSON.stringify([x.key, x.mode, x.target, x.channel, x.value])).sort();
    expect(all(after)).toEqual(all(before));
    expect(inputAutoKeys(after, reg, main(after), wheel, 'speed')).toEqual([]);
    expect(inputBindings(after, reg, main(after), wheel, 'speed').map((m) => m.binding.key)).toEqual(['d', 'a']);
    // One step back and both the bindings and the switch are as they were.
    history.undo();
    expect(history.present).toBe(before);
    expect(history.canUndo).toBe(false);
  });

  it('leaves alone a part with nothing to claim', () => {
    const once = claimAuto(bp, reg, undefined, [wheel]);
    expect(claimAuto(once, reg, undefined, [wheel])).toBe(once);
    expect(claimAuto(bp, reg, undefined, ['core@1,1'])).toBe(bp);
    const off = withControls(bp, reg, undefined, { autoOn: false });
    expect(claimAuto(off, reg, undefined, [wheel])).toBe(off);
  });

  it('by kind, every wheel claimed together is one binding a key for the kind', () => {
    const wheels = ['wheel@0,0', 'wheel@1,0', 'wheel@2,0'];
    const after = claimAuto(bp, reg, undefined, wheels, { byKind: true });
    expect(after.bindings).toEqual([
      { key: 'd', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 },
      { key: 'a', mode: 'hold', target: 'wheel', channel: 'speed', value: -1 },
    ]);
    expect(after.parts.filter((p) => p.auto === false).map((p) => p.id)).toEqual(wheels);
    // Only two of the three: the kind's name would catch the third, so each gets its own.
    const two = claimAuto(bp, reg, undefined, wheels.slice(0, 2), { byKind: true });
    expect(two.bindings.map((b) => b.target)).toEqual(['wheel@0,0', 'wheel@0,0', 'wheel@1,0', 'wheel@1,0']);
  });
});

describe('who owns each key', () => {
  it('lights auto keys, yours, and script switches, and knows the world keys', () => {
    const b = withKeys([
      { key: 'f', mode: 'pulse', target: 'left', channel: 'throttle', value: 1 },
      { key: 'h', mode: 'script', script: 'hover' },
    ]);
    const owners = keyOwners(b, reg, main(b));
    expect(ownerKind(owners.get('f'))).toBe('yours');
    expect(ownerKind(owners.get('h'))).toBe('script');
    expect(ownerKind(owners.get('d'))).toBe('auto');
    expect(ownerKind(owners.get('w'))).toBe('auto');
    expect(ownerKind(owners.get('g'))).toBe('free');
    expect(ownerKind(owners.get('ArrowUp'))).toBe('free');
    expect(owners.get('d')?.auto.map((a) => a.text)).toEqual(['3 Wheels forward']);
    expect(owners.get('w')?.auto[0]?.ids).toEqual(['propeller@0,1', 'propeller@2,1']);
    expect(ownerKind(owners.get('Space'))).toBe('world');
    expect(owners.get('Space')?.world).toBe('Space pauses the world');
    expect(owners.get('Tab')?.world).toBe('Tab switches between builder and world');
  });

  it('draws every world key on the keyboard, and every letter and digit as the robot own', () => {
    const drawn = KEYBOARD.flatMap((r) => r.keys);
    for (const code of Object.keys(WORLD_KEYS)) expect(drawn.map((k) => k.code)).toContain(code);
    const owners = keyOwners(bp, reg, main(bp));
    for (const k of drawn) {
      if (/^(Key[A-Z]|Digit[0-9]|Arrow)/.test(k.code)) expect(owners.get(k.key)?.world, k.code).toBeUndefined();
    }
    expect(drawn.filter((k) => /^Key[A-Z]$/.test(k.code)).length).toBe(26);
    expect(drawn.filter((k) => /^Digit[0-9]$/.test(k.code)).length).toBe(10);
    // No row is wider than the panel: 12 and a half keys.
    for (const row of KEYBOARD) expect(row.indent + row.keys.reduce((w, k) => w + (k.w ?? 1), 0)).toBeLessThanOrEqual(12.5);
  });

  it('a key doing two unrelated things clashes; one input through two targets, or auto keys alone, do not', () => {
    const clash = (bindings: Binding[], key: string): boolean | undefined => {
      const b = withKeys(bindings);
      return keyOwners(b, reg, main(b)).get(key)?.clash;
    };
    // Two targets, one input: related.
    expect(clash([{ key: 'f', mode: 'hold', target: 'wheel@0,0', channel: 'speed', value: 1 }, { key: 'f', mode: 'hold', target: 'wheel@1,0', channel: 'speed', value: 1 }], 'f')).toBe(false);
    // Two inputs on one key.
    expect(clash([{ key: 'f', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }, { key: 'f', mode: 'hold', target: 'propeller', channel: 'throttle', value: 1 }], 'f')).toBe(true);
    // Yours on top of an auto key for another input (W lifts the propellers).
    expect(clash([{ key: 'w', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }], 'w')).toBe(true);
    // Yours on top of an auto key for the same input.
    expect(clash([{ key: 'd', mode: 'hold', target: 'left', channel: 'speed', value: 0.5 }], 'd')).toBe(false);
    // A script switch beside an input.
    expect(clash([{ key: 'h', mode: 'script', script: 'hover' }, { key: 'h', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }], 'h')).toBe(true);
    expect(clash([{ key: 'h', mode: 'script', script: 'hover' }], 'h')).toBe(false);
    // Auto keys alone never clash, whatever they drive together.
    expect(clash([], 'd')).toBe(false);
    expect(clash([], 'w')).toBe(false);
  });

  it('a key bound in the file that is not drawn still shows up', () => {
    const b = withKeys([{ key: 'Semicolon', mode: 'hold', target: 'wheel', channel: 'speed', value: 1 }]);
    const owners = keyOwners(b, reg, main(b));
    expect(ownerKind(owners.get('Semicolon'))).toBe('yours');
    expect([...owners.keys()].at(-1)).toBe('Semicolon');
  });

  it('with auto keys off for the robot, no key is an auto key', () => {
    const off = withControls(bp, reg, undefined, { autoOn: false });
    expect(autoUses(off, reg, main(off))).toEqual([]);
    expect(ownerKind(keyOwners(off, reg, main(off)).get('d'))).toBe('free');
  });
});
