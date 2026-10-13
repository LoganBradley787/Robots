import { describe, expect, it } from 'vitest';
import { blankBlueprint, defaultRegistry, placePart } from '@robots/sim-core';
import { defaultHotbar, hotbarKey, pushRecent, readHotbar, readRecent, setSlot, swapSlots } from '../src/builder/hotbar';
import { initialEditor, reduce } from '../src/builder/editorState';

const registry = defaultRegistry();
const ids = registry.ids();

describe('the hotbar', () => {
  it('starts as the first nine parts of the registry', () => {
    expect(defaultHotbar(ids)).toEqual(ids.slice(0, 9));
    expect(defaultHotbar(['a', 'b'])).toEqual(['a', 'b', null, null, null, null, null, null, null]);
  });

  it('reads what was saved, and falls back to the start for anything unreadable', () => {
    const saved = ['gun', 'frame', null, 'core', null, null, null, null, 'wheel'];
    expect(readHotbar(JSON.stringify(saved), ids)).toEqual(saved);
    expect(readHotbar(null, ids)).toEqual(defaultHotbar(ids));
    expect(readHotbar('not json', ids)).toEqual(defaultHotbar(ids));
    expect(readHotbar('{"a":1}', ids)).toEqual(defaultHotbar(ids));
  });

  it('empties a slot whose part is gone and never refills it', () => {
    expect(readHotbar(JSON.stringify(['frame', 'no-such-part', 7, 'core']), ids)).toEqual(['frame', null, null, 'core', null, null, null, null, null]);
    // More than nine saved: the rest is dropped.
    expect(readHotbar(JSON.stringify(ids), ids)).toEqual(ids.slice(0, 9));
  });

  it('sets and swaps slots without touching the hotbar it was given', () => {
    const h = defaultHotbar(ids);
    const set = setSlot(h, 2, 'gun');
    expect(set[2]).toBe('gun');
    expect(h[2]).toBe(ids[2]);
    expect(setSlot(h, 2, ids[2] ?? null)).toBe(h);
    expect(setSlot(h, 9, 'gun')).toBe(h);
    expect(setSlot(h, 0, null)[0]).toBeNull();
    const swapped = swapSlots(h, 0, 8);
    expect([swapped[0], swapped[8]]).toEqual([ids[8], ids[0]]);
    expect(swapSlots(h, 3, 3)).toBe(h);
    expect(swapSlots(h, -1, 3)).toBe(h);
  });

  it('gives the key of a part on it', () => {
    const h = setSlot(defaultHotbar(ids), 4, 'gun');
    expect(hotbarKey(h, 'gun')).toBe('5');
    expect(hotbarKey(h, ids[0] ?? '')).toBe('1');
    expect(hotbarKey(h, 'laser')).toBeUndefined();
  });

  it('the number keys pick what is on the hotbar, and an empty slot picks nothing', () => {
    const h = setSlot(setSlot(defaultHotbar(ids), 0, 'gun'), 1, null);
    const slots = h.map((s) => s ?? '');
    const bp = blankBlueprint('t');
    expect(reduce(initialEditor(), bp, { type: 'pick', index: 0 }, registry, slots).editor.held?.part).toBe('gun');
    expect(reduce(initialEditor(), bp, { type: 'pick', index: 1 }, registry, slots).editor.held).toBeUndefined();
    expect(reduce(initialEditor(), bp, { type: 'pick', index: 2 }, registry, slots).editor.held?.part).toBe(ids[2]);
    // An empty slot leaves what is in hand alone.
    const holding = reduce(initialEditor(), bp, { type: 'hold', part: 'frame' }, registry, slots).editor;
    expect(reduce(holding, placePart(bp, registry, 'core', 0, 0, 0), { type: 'pick', index: 1 }, registry, slots).editor.held?.part).toBe('frame');
  });
});

describe('the recent row', () => {
  it('puts a new part first and keeps three', () => {
    expect(pushRecent([], 'a')).toEqual(['a']);
    expect(pushRecent(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b']);
  });

  it('does not shuffle when a part already in the row is taken', () => {
    const row = ['a', 'b', 'c'];
    expect(pushRecent(row, 'c')).toBe(row);
  });

  it('reads only parts that exist', () => {
    expect(readRecent(JSON.stringify(['gun', 'nope', 'frame']), ids)).toEqual(['gun', 'frame']);
    expect(readRecent('garbage', ids)).toEqual([]);
    expect(readRecent(null, ids)).toEqual([]);
  });
});
