import { describe, expect, it } from 'vitest';
import { categoryOf, defaultRegistry, expandBlueprint, OTHER_CATEGORY, parsePartDef, PART_CATEGORIES, toFileJson, validateBlueprint } from '@robots/sim-core';
import { cleanKind, groupByKind, kindsOf, matches, NO_KIND, partMatches, partSections } from '../src/builder/library';
import { handleBlueprintRequest, setKindInText, type FileStore } from '../src/storage/blueprintHandler';

const registry = defaultRegistry();

describe('part categories', () => {
  it('every shipped part has a category the drawer knows and a line about it', () => {
    for (const d of registry.list()) {
      expect(PART_CATEGORIES, d.id).toContain(d.category);
      expect(d.category, d.id).not.toBe(OTHER_CATEGORY);
      expect((d.about ?? '').length, d.id).toBeGreaterThan(10);
      expect(d.about, d.id).not.toMatch(/—/);
    }
  });

  it('a part with no category, or one the drawer does not know, goes under Other', () => {
    expect(categoryOf({})).toBe(OTHER_CATEGORY);
    expect(categoryOf({ category: 'Gadgets' })).toBe(OTHER_CATEGORY);
    expect(categoryOf({ category: 'Joints' })).toBe('Joints');
    const raw = { id: 'thing', name: 'Thing', footprint: [{ x: 0, y: 0, faces: ['N'] }], mass: 1, health: 1, symmetry: 4, inputs: [], outputs: [], powerDraw: 0, sprite: { frame: 'part.frame' } };
    expect(categoryOf(parsePartDef(raw, 'thing.json'))).toBe(OTHER_CATEGORY);
    const odd = parsePartDef({ ...raw, category: 'Gadgets', about: 'Does a thing.' }, 'thing.json');
    expect([odd.category, odd.about, categoryOf(odd)]).toEqual(['Gadgets', 'Does a thing.', OTHER_CATEGORY]);
    expect(() => parsePartDef({ ...raw, category: '' }, 'thing.json')).toThrow(/category/);
  });

  it('the drawer lists every part of the registry once, under its section', () => {
    const sections = partSections(registry.list());
    expect(sections.flatMap((s) => s.parts.map((p) => p.id)).sort()).toEqual(registry.ids().sort());
    expect(sections.map((s) => s.category)).toEqual(PART_CATEGORIES.filter((c) => c !== OTHER_CATEGORY));
    // A part the drawer has no section for still shows.
    const stray = { ...registry.get('frame'), id: 'stray', category: 'Gadgets' };
    expect(partSections([...registry.list(), stray]).at(-1)).toMatchObject({ category: OTHER_CATEGORY, parts: [{ id: 'stray' }] });
  });

  it('search looks at the name, what it does, and the section', () => {
    const frame = registry.get('frame');
    expect(partMatches(frame, 'fra')).toBe(true);
    expect(partMatches(frame, 'bolts')).toBe(true);
    expect(partMatches(frame, 'structure')).toBe(true);
    expect(partMatches(frame, 'wheel')).toBe(false);
    expect(partSections(registry.list(), 'zzzz')).toEqual([]);
  });
});

describe("a blueprint's kind", () => {
  const raw = { format: 1, name: 'car', kind: 'enemy', grid: ['F C F', 'W . W'] };

  it('is kept through load and save, right after the name', () => {
    const { blueprint, issues } = expandBlueprint(raw);
    expect(issues).toEqual([]);
    expect(blueprint?.kind).toBe('enemy');
    const out = toFileJson(blueprint!, registry);
    expect(Object.keys(out).slice(0, 3)).toEqual(['format', 'name', 'kind']);
    expect(out.kind).toBe('enemy');
    expect(expandBlueprint(out).blueprint?.kind).toBe('enemy');
  });

  it('is optional, and the validator takes a file with one', () => {
    const { kind: _kind, ...plain } = raw;
    expect(expandBlueprint(plain).blueprint?.kind).toBeUndefined();
    expect('kind' in toFileJson(expandBlueprint(plain).blueprint!, registry)).toBe(false);
    expect(validateBlueprint(raw, registry).ok).toBe(true);
  });

  it('must be text when present', () => {
    for (const kind of ['', 3, null, ['x']]) expect(expandBlueprint({ ...raw, kind }).issues[0]).toMatchObject({ code: 'BAD_FORMAT', path: 'kind' });
  });

  it('is cleaned up as it is typed', () => {
    expect(cleanKind('  Big   Bosses ')).toBe('big bosses');
    expect(cleanKind('   ')).toBeUndefined();
    expect(cleanKind(NO_KIND)).toBeUndefined();
  });
});

describe('the library', () => {
  const files = [
    { file: 'zed.json', name: 'zed', kind: 'yours' },
    { file: 'enemy-drone.json', name: 'enemy drone', kind: 'enemy' },
    { file: 'a.json', name: 'alpha', kind: 'yours' },
    { file: 'boss.json', name: 'boss', kind: 'bosses' },
    { file: 'loose.json', name: 'loose' },
  ];

  it('groups by kind: the usual kinds first, others by name, no kind last, names in order', () => {
    expect(groupByKind(files).map((g) => [g.kind, g.files.map((f) => f.name)])).toEqual([
      ['yours', ['alpha', 'zed']],
      ['enemy', ['enemy drone']],
      ['bosses', ['boss']],
      [NO_KIND, ['loose']],
    ]);
  });

  it('hides nothing, and search narrows by name, file or kind', () => {
    expect(groupByKind(files).flatMap((g) => g.files).length).toBe(files.length);
    expect(groupByKind(files, 'drone').map((g) => g.kind)).toEqual(['enemy']);
    expect(groupByKind(files, 'bosses').flatMap((g) => g.files.map((f) => f.name))).toEqual(['boss']);
    expect(groupByKind(files, 'nothing like it')).toEqual([]);
    expect(matches({ file: 'enemy-fab-gun-drone.json', name: 'enemy-fab-gun-drone' }, 'GUN fab')).toBe(true);
  });

  it('offers the usual kinds and every kind in use, a new one included', () => {
    expect(kindsOf(files)).toEqual(['yours', 'enemy', 'missile', 'piece', 'bosses']);
    expect(kindsOf(files, 'walkers')).toEqual(['yours', 'enemy', 'missile', 'piece', 'bosses', 'walkers']);
  });
});

describe('setting a kind in a file', () => {
  const text = '{\n  "format": 1,\n  "name": "car",\n  "grid": [\n    "F  C  F",\n    "W  .  W"\n  ],\n  "legend": { "X": { "part": "frame", "tags": ["a"] } }\n}\n';

  it('adds one line after the name and leaves the rest of the file as it was written', () => {
    expect(setKindInText(text, 'enemy')).toBe(text.replace('"name": "car",\n', '"name": "car",\n  "kind": "enemy",\n'));
  });

  it('changes or removes the line that is there', () => {
    const withKind = setKindInText(text, 'enemy') ?? '';
    expect(setKindInText(withKind, 'piece')).toBe(withKind.replace('"enemy"', '"piece"'));
    expect(setKindInText(withKind, undefined)).toBe(text);
    expect(setKindInText(text, undefined)).toBe(text);
  });

  it('only touches the top-level kind, not one inside a recipe', () => {
    const nested = '{\n  "format": 1,\n  "name": "bay",\n  "kind": "yours",\n  "grid": ["C"],\n  "recipes": {\n    "m": {\n      "format": 1,\n      "name": "m",\n      "kind": "missile",\n      "grid": ["C"]\n    }\n  }\n}\n';
    const out = JSON.parse(setKindInText(nested, 'enemy') ?? '') as { kind: string; recipes: { m: { kind: string } } };
    expect([out.kind, out.recipes.m.kind]).toEqual(['enemy', 'missile']);
  });

  it('rewrites a file laid out on one line, and refuses what is not a blueprint object', () => {
    expect(JSON.parse(setKindInText('{"format":1,"name":"car","grid":["C"]}', 'enemy') ?? '')).toEqual({ format: 1, name: 'car', kind: 'enemy', grid: ['C'] });
    expect(setKindInText('nope', 'enemy')).toBeUndefined();
    expect(setKindInText('[1]', 'enemy')).toBeUndefined();
  });

  it('the file API lists kinds and patches one', () => {
    const data: Record<string, string> = { 'car.json': text, 'old.json': '{"name":"Old"}' };
    const store: FileStore = { list: () => Object.keys(data), read: (f) => data[f], write: (f, t) => void (data[f] = t), remove: (f) => void delete data[f] };
    expect(handleBlueprintRequest('PATCH', '/car.json', '{"kind":" enemy "}', store).status).toBe(200);
    expect(JSON.parse(handleBlueprintRequest('GET', '/', '', store).body)).toEqual([
      { file: 'car.json', name: 'car', kind: 'enemy' },
      { file: 'old.json', name: 'Old' },
    ]);
    expect(handleBlueprintRequest('PATCH', '/car.json', '{"kind":null}', store).status).toBe(200);
    expect(data['car.json']).toBe(text);
    expect(handleBlueprintRequest('PATCH', '/car.json', '{"kind":7}', store).status).toBe(400);
    expect(handleBlueprintRequest('PATCH', '/gone.json', '{"kind":"x"}', store).status).toBe(404);
  });
});
