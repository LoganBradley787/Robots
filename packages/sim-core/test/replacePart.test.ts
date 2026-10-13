import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { placePart, replacePartAt, replacePartType, type ReplaceResult } from '../src/blueprint/edit';
import { matchesTarget } from '../src/control/target';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(raw: Record<string, unknown>): Blueprint {
  const r = expandBlueprint({ format: 1, name: 'x', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

function done(r: ReplaceResult): Extract<ReplaceResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error);
  return r;
}

const part = (b: Blueprint, id: string) => b.parts.find((p) => p.id === id);

/** A rocket: a core, a thruster below it with tags and auto keys off, a warhead on top that starts armed, a frame beside. */
const rocket = (): Blueprint =>
  bp({
    grid: ['w  .', 'C  F', 't  .'],
    legend: { t: { part: 'thruster', rot: 180, tags: ['main', 'burn'], auto: false }, w: { part: 'warhead', tags: ['tip'], armed: true } },
    bindings: [
      { key: 'j', mode: 'hold', target: 'thruster@0,0', channel: 'throttle', value: 1 },
      { key: 'k', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 },
      { key: 'l', mode: 'hold', target: 'main', channel: 'throttle', value: 1 },
    ],
  });

describe('replacePartType (M16)', () => {
  it('keeps place, rotation, explicit tags, part order and the settings the new part has too', () => {
    const b = rocket();
    const r = done(replacePartType(b, reg, 'thruster@0,0', 'swivelthruster'));
    expect(part(r.blueprint, 'swivelthruster@0,0')).toEqual({ id: 'swivelthruster@0,0', part: 'swivelthruster', x: 0, y: 0, rot: 180, tags: ['main', 'burn', 'swivelthruster@0,0'], auto: false });
    expect(r.blueprint.parts.map((p) => p.id)).toEqual(['warhead@0,2', 'core@0,1', 'frame@1,1', 'swivelthruster@0,0']);
    expect(r.report).toEqual({
      from: 'thruster',
      to: 'swivelthruster',
      oldId: 'thruster@0,0',
      newId: 'swivelthruster@0,0',
      kept: { rot: 180, tags: ['main', 'burn'], settings: ['auto'] },
      dropped: [],
    });
    expect([...r.ids]).toEqual([['thruster@0,0', 'swivelthruster@0,0']]);
    expect(part(b, 'thruster@0,0')).toBeDefined();
  });

  it('follows the id in bindings, and leaves a binding to the old type name as it was', () => {
    const r = done(replacePartType(rocket(), reg, 'thruster@0,0', 'booster'));
    expect(r.blueprint.bindings.map((x) => x.target)).toEqual(['booster@0,0', 'thruster', 'main']);
    // The type binding no longer reaches it: that is what keepTypeTag is for.
    expect(matchesTarget(part(r.blueprint, 'booster@0,0') as { part: string; tags: string[] }, 'thruster')).toBe(false);
  });

  it('keepTypeTag adds the old type as a tag, so a driver by type name still reaches the new part', () => {
    const r = done(replacePartType(rocket(), reg, 'thruster@0,0', 'swivelthruster', { keepTypeTag: true }));
    const made = part(r.blueprint, 'swivelthruster@0,0');
    expect(made?.tags).toEqual(['main', 'burn', 'thruster', 'swivelthruster@0,0']);
    expect(r.report.typeTag).toBe('thruster');
    expect(r.report.kept.tags).toEqual(['main', 'burn']);
    expect(matchesTarget(made as { part: string; tags: string[] }, 'thruster')).toBe(true);
    // Swapped again, the first type's tag stays and the second joins it; swapped back to the first, its tag is redundant and goes.
    const again = done(replacePartType(r.blueprint, reg, 'swivelthruster@0,0', 'booster', { keepTypeTag: true }));
    expect(part(again.blueprint, 'booster@0,0')?.tags).toEqual(['main', 'burn', 'thruster', 'swivelthruster', 'booster@0,0']);
    const back = done(replacePartType(r.blueprint, reg, 'swivelthruster@0,0', 'thruster'));
    expect(part(back.blueprint, 'thruster@0,0')).toEqual(part(rocket(), 'thruster@0,0'));
    expect(back.report.dropped).toEqual([{ what: 'tag', value: 'thruster', why: "a thruster answers to 'thruster' as its type" }]);
  });

  it('drops the settings the new part does not have, each with its reason', () => {
    const b = rocket();
    const t = done(replacePartType(b, reg, 'thruster@0,0', 'frame'));
    expect(part(t.blueprint, 'frame@0,0')).toEqual({ id: 'frame@0,0', part: 'frame', x: 0, y: 0, rot: 180, tags: ['main', 'burn', 'frame@0,0'] });
    expect(t.report.kept.settings).toEqual([]);
    expect(t.report.dropped).toEqual([{ what: 'auto', value: 'off', why: 'a frame has no auto keys to turn off' }]);
    const w = done(replacePartType(b, reg, 'warhead@0,2', 'gun'));
    expect(part(w.blueprint, 'gun@0,2')).toEqual({ id: 'gun@0,2', part: 'gun', x: 0, y: 2, rot: 0, tags: ['tip', 'gun@0,2'] });
    expect(w.report.dropped).toEqual([{ what: 'armed', value: 'armed', why: 'a gun is never armed' }]);
    // A heavier warhead arms too: it stays armed.
    const h = done(replacePartType(b, reg, 'warhead@0,2', 'heavywarhead'));
    expect(part(h.blueprint, 'heavywarhead@0,2')?.armed).toBe(true);
    expect(h.report.kept.settings).toEqual(['armed']);
  });

  it('drops what a bay made and its size when the new part is no bay, and the recipe nothing makes any more', () => {
    const b = bp({
      grid: ['.  =  .  =  .', '.  =  .  =  .', '.  =  b  =  .', 'C  F  F  F  .'],
      legend: { b: { part: 'fabbay', tags: ['bay'], makes: 'pod', size: [1, 2] } },
      recipes: { pod: { format: 1, name: 'pod', grid: ['C'] } },
    });
    const r = done(replacePartType(b, reg, 'fabbay@2,1', 'frame'));
    expect(part(r.blueprint, 'frame@2,1')).toEqual({ id: 'frame@2,1', part: 'frame', x: 2, y: 1, rot: 0, tags: ['bay', 'frame@2,1'] });
    expect(r.blueprint.recipes).toBeUndefined();
    expect(r.report.dropped).toEqual([
      { what: 'makes', value: 'pod', why: 'a frame builds nothing' },
      { what: 'size', value: '1 by 2', why: 'a frame has one size' },
      { what: 'recipe', value: 'pod', why: 'no part makes it any more' },
    ]);
  });

  it('refuses when the new footprint does not fit, changing nothing', () => {
    const b = bp({ grid: ['F  F', 'g  F', 'C  F'], legend: { g: { part: 'gun', tags: ['guns'] } } });
    // A laser is two cells tall: its barrel would be where the frame above the gun is.
    expect(replacePartType(b, reg, 'gun@0,1', 'laser')).toEqual({ ok: false, error: 'a laser does not fit in place of gun@0,1: it would cover frame@0,2 at (0, 2)' });
    // Turned to point right it would cover the frame beside it instead.
    const turned = bp({ grid: ['g  F', 'C  F'], legend: { g: { part: 'gun', rot: 270 } } });
    expect(replacePartType(turned, reg, 'gun@0,1', 'laser')).toMatchObject({ ok: false });
    // With room above, it fits, and keeps its tag.
    const room = bp({ grid: ['.  F', 'g  F', 'C  F'], legend: { g: { part: 'gun', tags: ['guns'] } } });
    expect(part(done(replacePartType(room, reg, 'gun@0,1', 'laser')).blueprint, 'laser@0,1')?.tags).toEqual(['guns', 'laser@0,1']);
  });

  it('replaces a multi-cell part with a one-cell part, freeing its other cells', () => {
    const b = bp({ parts: [{ part: 'core', x: 0, y: 0 }, { part: 'laser', x: 1, y: 0, tags: ['beam'] }] });
    const r = done(replacePartType(b, reg, 'laser@1,0', 'gun', { keepTypeTag: true }));
    expect(part(r.blueprint, 'gun@1,0')).toEqual({ id: 'gun@1,0', part: 'gun', x: 1, y: 0, rot: 0, tags: ['beam', 'laser', 'gun@1,0'] });
    expect(placePart(r.blueprint, reg, 'frame', 1, 1, 0).parts).toHaveLength(3);
  });

  it('keeps a hand-written id', () => {
    const b = bp({
      parts: [{ part: 'core', x: 0, y: 0 }, { id: 'left-gun', part: 'gun', x: 1, y: 0, tags: ['guns'] }],
      bindings: [{ key: 'f', mode: 'hold', target: 'left-gun', channel: 'fire', value: 1 }],
    });
    const r = done(replacePartType(b, reg, 'left-gun', 'grapple'));
    expect(part(r.blueprint, 'left-gun')).toEqual({ id: 'left-gun', part: 'grapple', x: 1, y: 0, rot: 0, tags: ['guns', 'left-gun'] });
    expect(r.blueprint.bindings).toEqual(b.bindings);
    expect(r.report.newId).toBe('left-gun');
  });

  it('changes nothing for the same type, and refuses a part or a type that does not exist', () => {
    const b = rocket();
    const same = done(replacePartType(b, reg, 'thruster@0,0', 'thruster', { keepTypeTag: true }));
    expect(same.blueprint).toBe(b);
    expect(same.report).toMatchObject({ kept: { tags: ['main', 'burn'], settings: ['auto'] }, dropped: [] });
    expect(replacePartType(b, reg, 'thruster@9,9', 'frame')).toEqual({ ok: false, error: "there is no part 'thruster@9,9' to replace" });
    expect(replacePartType(b, reg, 'thruster@0,0', 'thrustr')).toMatchObject({ ok: false, error: expect.stringMatching(/^there is no part 'thrustr' \(known: core, frame, /) });
  });

  it('a second core that becomes something else takes its controls with it; a scoped part swapped keeps its scoped tags', () => {
    const b = bp({
      grid: ['K  w', 'D  .', 'C  F'],
      legend: { K: { part: 'core', tags: ['missile1', 'missile1.brain'] }, w: { part: 'warhead', tags: ['missile1', 'missile1.tip'], armed: true }, D: { part: 'decoupler' } },
      primaryCore: 'core@0,0',
      corePriority: ['core@0,0', 'core@0,2'],
      bindings: [{ key: 'z', mode: 'pulse', target: 'missile1.tip', channel: 'detonate', value: 1 }],
      cores: { 'core@0,2': { scope: 'missile1', bindings: [{ key: 'x', mode: 'pulse', target: 'tip', channel: 'detonate', value: 1 }], scripts: [] } },
    });
    const w = done(replacePartType(b, reg, 'warhead@1,2', 'heavywarhead', { keepTypeTag: true }));
    expect(part(w.blueprint, 'heavywarhead@1,2')).toEqual({ id: 'heavywarhead@1,2', part: 'heavywarhead', x: 1, y: 2, rot: 0, tags: ['missile1', 'missile1.tip', 'warhead', 'heavywarhead@1,2'], armed: true });
    expect(w.blueprint.cores).toEqual(b.cores);
    const k = done(replacePartType(b, reg, 'core@0,2', 'frame'));
    expect(k.blueprint.cores).toBeUndefined();
    expect(k.blueprint.corePriority).toEqual(['core@0,0']);
    expect(k.blueprint.primaryCore).toBe('core@0,0');
    expect(part(k.blueprint, 'frame@0,2')?.tags).toEqual(['missile1', 'missile1.brain', 'frame@0,2']);
    expect(k.blueprint.parts.map((p) => p.id)).toEqual(['frame@0,2', 'warhead@1,2', 'decoupler@0,1', 'core@0,0', 'frame@1,0']);
    expect(k.report.dropped).toEqual([{ what: 'core', value: 'core@0,2', why: 'a frame is not a core: nothing can be controlled from it' }]);
  });
});

describe('placePart with swap, and replacePartAt (M16)', () => {
  it('without the option a placed part is blank, as it always was', () => {
    const b = rocket();
    expect(part(placePart(b, reg, 'booster', 0, 0, 180), 'booster@0,0')).toEqual({ id: 'booster@0,0', part: 'booster', x: 0, y: 0, rot: 180, tags: ['booster@0,0'] });
    expect(part(placePart(b, reg, 'booster', 0, 0, 180, {}), 'booster@0,0')?.tags).toEqual(['booster@0,0']);
    // Appended, and the binding to the old id is left pointing at nothing, as before.
    expect(placePart(b, reg, 'booster', 0, 0, 180).parts.map((p) => p.id)).toEqual(['warhead@0,2', 'core@0,1', 'frame@1,1', 'booster@0,0']);
    expect(placePart(b, reg, 'booster', 0, 0, 180).bindings).toEqual(b.bindings);
  });

  it('with swap the part it covers keeps its tags and settings, and takes the turn of the part held', () => {
    const b = rocket();
    const out = placePart(b, reg, 'booster', 0, 0, 90, { swap: true, keepTypeTag: true });
    expect(part(out, 'booster@0,0')).toEqual({ id: 'booster@0,0', part: 'booster', x: 0, y: 0, rot: 90, tags: ['main', 'burn', 'thruster', 'booster@0,0'], auto: false });
    expect(out.bindings.map((x) => x.target)).toEqual(['booster@0,0', 'thruster', 'main']);
    // The same part held at another turn: the tags stay (a plain place would reset them).
    expect(part(placePart(b, reg, 'thruster', 0, 0, 0, { swap: true }), 'thruster@0,0')).toEqual({ id: 'thruster@0,0', part: 'thruster', x: 0, y: 0, rot: 0, tags: ['main', 'burn', 'thruster@0,0'], auto: false });
    expect(placePart(b, reg, 'thruster', 0, 0, 180, { swap: true })).toBe(b);
  });

  it('with swap on an empty cell, or over several parts, it places as a plain place does', () => {
    const b = rocket();
    expect(placePart(b, reg, 'frame', 1, 0, 0, { swap: true })).toEqual(placePart(b, reg, 'frame', 1, 0, 0));
    // A laser at (0, 0) covers the thruster and the core above it.
    expect(placePart(b, reg, 'laser', 0, 0, 0, { swap: true })).toEqual(placePart(b, reg, 'laser', 0, 0, 0));
  });

  it('replacePartAt reports the swap, and refuses no part or several', () => {
    const b = rocket();
    const r = done(replacePartAt(b, reg, 'booster', 0, 0, 90, { keepTypeTag: true }));
    expect(r.blueprint).toEqual(placePart(b, reg, 'booster', 0, 0, 90, { swap: true, keepTypeTag: true }));
    expect(r.report).toMatchObject({ from: 'thruster', to: 'booster', kept: { rot: 90, tags: ['main', 'burn'], settings: ['auto'] }, typeTag: 'thruster' });
    expect(replacePartAt(b, reg, 'frame', 1, 0, 0)).toEqual({ ok: false, error: 'there is no part at (1, 0) to replace' });
    expect(replacePartAt(b, reg, 'laser', 0, 0, 0)).toEqual({ ok: false, error: 'a laser at (0, 0) would cover 2 parts (core@0,1, thruster@0,0); it can take the place of one' });
  });

  it('a multi-cell part held over a one-cell part takes its place where it is held', () => {
    const b = bp({ grid: ['.  .', 'g  .', 'C  F'], legend: { g: { part: 'gun', tags: ['guns'] } } });
    // Held with its origin on the empty cell above, turned upside down so its barrel is on the gun's cell.
    const r = done(replacePartAt(b, reg, 'laser', 0, 2, 180));
    expect(part(r.blueprint, 'laser@0,2')).toEqual({ id: 'laser@0,2', part: 'laser', x: 0, y: 2, rot: 180, tags: ['guns', 'laser@0,2'] });
    expect(r.report).toMatchObject({ oldId: 'gun@0,1', newId: 'laser@0,2' });
  });
});
