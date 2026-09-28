import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import { resolveScripts } from '../src/blueprint/scripts';
import { validateBlueprint } from '../src/blueprint/validate';
import { toFileJson } from '../src/blueprint/serialize';
import { defaultRegistry } from '../src/parts/registry';
import { hollowCells, recipeStats } from '../src/fabricate/recipe';
import { buildReplay, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
const registry = defaultRegistry();
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const missileUp = resolveScripts(JSON.parse(bpFile('missile-up.json')), bpFile).raw;
/** A ground base with a bay making `missile-up` on top: R lets go of what it holds. */
const bayBot = (recipe: unknown = missileUp, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 1,
  name: 'bay-bot',
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'densebattery', x: -1, y: 0 },
    { part: 'densebattery', x: 1, y: 0 },
    { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
  ],
  recipes: { item: recipe },
  bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
  ...extra,
});
const events = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
const tap = (robot: number, key: string) => [{ robot, pressed: [key], released: [] }];
const lift = (robot: number, key: string) => [{ robot, pressed: [], released: [key] }];
const BUILD_S = 0.6 * 6.8;

describe('fabricator bay: the part and recipes (M12)', () => {
  it('the bay: a 3 by 6 U whose five-cell hollow fits a missile-up; the costs come from the recipe', () => {
    const bay = registry.get('fabbay');
    expect(bay.fabricate).toEqual({ joulesPerKg: 40, secondsPerKg: 0.6, separation: 4 });
    expect(hollowCells(bay)).toEqual([1, 2, 3, 4, 5].map((y) => ({ x: 0, y })));
    const v = validateBlueprint(missileUp, registry);
    expect(recipeStats(v.blueprint!, registry)).toEqual({ mass: 6.8, stored: 600 });
  });

  it('validates: makes needs a fabricator and a recipe, and the recipe must be valid and fit', () => {
    expect(validateBlueprint(bayBot(), registry).ok).toBe(true);
    const codes = (raw: unknown): string[] => validateBlueprint(raw, registry).issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes({ ...bayBot(), recipes: undefined })).toContain('BAD_MAKES');
    const onFrame = bayBot();
    (onFrame.parts as Record<string, unknown>[]).push({ part: 'frame', x: 2, y: 0, makes: 'item' });
    expect(codes(onFrame)).toContain('BAD_MAKES');
    expect(codes(bayBot({ format: 1, name: 'wide', grid: ['C  F'] }))).toContain('BAD_RECIPE');
    expect(validateBlueprint(bayBot({ format: 1, name: 'wide', grid: ['C  F'] }), registry).issues.find((i) => i.code === 'BAD_RECIPE')?.message).toMatch(/does not fit a fabbay's hollow \(1 wide, 5 tall/);
    expect(codes(bayBot({ format: 1, name: 'broken', grid: ['C  .  F'] }))).toContain('UNATTACHED');
    expect(codes({ ...bayBot(), recipes: { item: { ...(missileUp as object), recipes: {} } } })).toContain('BAD_RECIPE');
  });

  it('saves and reloads with its recipe and what the bay makes', () => {
    const v = validateBlueprint(bayBot(), registry);
    const file = toFileJson(v.blueprint!, registry, { inlineScripts: true });
    expect(Object.keys(file.recipes as object)).toEqual(['item']);
    const again = validateBlueprint(file, registry);
    expect(again.ok).toBe(true);
    expect(again.blueprint?.parts.find((p) => p.part === 'fabbay')?.makes).toBe('item');
  });
});

describe('fabricator bay: building and letting go (M12)', () => {
  it('builds a missile-up in about 4.1 s out of 872 J, held in the bay with its core asleep', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    const before = w.energy(r.id)?.stored ?? 0;
    let at = -1;
    for (let t = 0; t < 400 && at < 0; t++) {
      w.step();
      if (events(w, 'built').length > 0) at = t;
    }
    expect(at / 60).toBeCloseTo(BUILD_S, 1);
    expect(events(w, 'built')).toMatchObject([{ robot: r.id, part: 'fabbay@0,1', recipe: 'item', scope: 'bay1' }]);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'ready')).toBe(1);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'built')).toBe(1);
    const core = [...r.parts.values()].find((p) => p.def.id === 'core' && p.tags.includes('bay1'));
    expect(core).toBeDefined();
    // One robot still: the bay holds it. Energy: the 872 J it cost, and the new core's full 600 J joined the pool.
    expect(w.robots).toHaveLength(1);
    expect(w.energy(r.id)?.stored).toBeCloseTo(before - 872 + 600, 0);
    w.dispose();
  });

  it('released, it slides out, wakes, and flies on its own; the bay builds the next once its hollow is clear', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    for (let t = 0; t < 260; t++) w.step();
    w.step(tap(r.id, 'r'));
    w.step(lift(r.id, 'r'));
    expect(events(w, 'released')).toMatchObject([{ robot: r.id, scope: 'bay1' }]);
    const woke = events(w, 'coreWoke');
    expect(woke).toHaveLength(1);
    const missile = w.robots.find((x) => x.id === woke[0]?.robot);
    expect(w.scripts(missile?.id ?? 0).map((s) => s.id)).toEqual(['guide']);
    for (let t = 0; t < 120; t++) w.step();
    const s = w.physics.state(missile?.groups[0]?.bodyId ?? 0);
    expect(s.y).toBeGreaterThan(10);
    // The next one: another 4.1 s after the first left.
    for (let t = 0; t < 180; t++) w.step();
    expect(events(w, 'built')).toHaveLength(2);
    expect(events(w, 'built')[1]).toMatchObject({ scope: 'bay2' });
    w.dispose();
  });

  it('a finished item that never leaves blocks the next, until the bay pushes it out (Batch: after a second)', async () => {
    const w = await World.create({ seed: 1 }, flat);
    // A frame has no motor or core: let go, it just sits in the hollow.
    const r = w.spawnBlueprint(bayBot({ format: 1, name: 'lump', grid: ['F'] }), { x: -100, y: 0.5 });
    for (let t = 0; t < 60; t++) w.step();
    expect(events(w, 'built')).toHaveLength(1);
    w.step(tap(r.id, 'r'));
    w.step(lift(r.id, 'r'));
    for (let t = 0; t < 80; t++) w.step();
    expect(events(w, 'built')).toHaveLength(1);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'progress')).toBe(1);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'ready')).toBe(0);
    for (let t = 0; t < 300; t++) w.step();
    expect(events(w, 'built')).toHaveLength(2);
    w.dispose();
  });

  it('without enough energy it builds as far as the energy goes and waits', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const poor = bayBot();
    poor.parts = [{ part: 'core', x: 0, y: 0 }, { part: 'frame', x: -1, y: 0 }, { part: 'frame', x: 1, y: 0 }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }];
    const r = w.spawnBlueprint(poor, { x: -100, y: 0.5 });
    for (let t = 0; t < 600; t++) w.step();
    expect(events(w, 'built')).toHaveLength(0);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'progress')).toBeCloseTo(600 / 872, 2);
    w.dispose();
  });

  it('a bay destroyed mid-build builds nothing', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    for (let t = 0; t < 120; t++) w.step();
    const bay = r.parts.get('fabbay@0,1');
    if (bay) bay.health = 0;
    for (let t = 0; t < 300; t++) w.step();
    expect(events(w, 'built')).toHaveLength(0);
    w.dispose();
  });

  it('keeps held keys and toggles on across a build', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(bayBot(missileUp, { bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }, { key: 't', mode: 'toggle', target: 'bay', channel: 'release', value: 0 }] }), { x: -100, y: 0.5 });
    w.step([{ robot: r.id, pressed: ['t', 'w'], released: [] }]);
    for (let t = 0; t < 260; t++) w.step();
    expect(events(w, 'built')).toHaveLength(1);
    expect(w.controller(r.id)?.state()).toEqual({ held: ['t', 'w'], toggles: [1] });
    w.dispose();
  });

  it('a run with builds and a launch replays exactly; the bay is in the hash', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    const hashes: string[] = [];
    for (let t = 0; t < 400; t++) {
      w.step(t === 260 ? tap(r.id, 'r') : t === 261 ? lift(r.id, 'r') : []);
      if (t === 100 || t === 101) hashes.push(w.hash());
    }
    expect(hashes[0]).not.toBe(hashes[1]);
    const replay = JSON.parse(JSON.stringify(buildReplay(w)));
    const again = await runReplay(replay, undefined, host);
    expect(again.matches).toBe(true);
    expect(again.hash).toBe(w.hash());
    again.world.dispose();
    w.dispose();
  });
});

describe('setPartsMakes (M12)', () => {
  it('sets what bays make, adds or replaces the recipe, and drops recipes nothing makes', async () => {
    const { setPartsMakes } = await import('../src/blueprint/edit');
    const bp = validateBlueprint(bayBot(), registry).blueprint!;
    const frame = validateBlueprint({ format: 1, name: 'lump', grid: ['F'] }, registry).blueprint!;
    const lump = setPartsMakes(bp, ['fabbay@0,1'], { name: 'lump', blueprint: frame });
    expect(lump.parts.find((p) => p.id === 'fabbay@0,1')?.makes).toBe('lump');
    expect(lump.recipes?.map((r) => r.name)).toEqual(['lump']);
    const none = setPartsMakes(lump, ['fabbay@0,1'], undefined);
    expect(none.parts.find((p) => p.id === 'fabbay@0,1')?.makes).toBeUndefined();
    expect(none.recipes).toBeUndefined();
  });
});

describe('fabricator bay: review fixes (M12)', () => {
  const codes = (raw: unknown): string[] => validateBlueprint(raw, registry).issues.filter((i) => i.severity === 'error').map((i) => i.code);
  const withParts = (parts: Record<string, unknown>[], recipe: unknown = missileUp): Record<string, unknown> => ({ ...bayBot(recipe), parts });
  const base = [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: -1, y: 0 }, { part: 'densebattery', x: 1, y: 0 }];

  it('a bay needs a tag of its own, and nothing else may use its copies’ names', () => {
    expect(codes(withParts([...base, { part: 'fabbay', x: 0, y: 1, makes: 'item' }]))).toContain('BAD_MAKES');
    expect(codes(withParts([...base, { part: 'frame', x: 2, y: 0 }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }, { part: 'fabbay', x: 4, y: 0, tags: ['bay'], makes: 'item' }]))).toContain('BAD_MAKES');
    expect(codes(withParts([...base, { part: 'frame', x: 2, y: 0, tags: ['bay1'] }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }]))).toContain('BAD_MAKES');
  });

  it('its hollow must be empty, and a lid over its mouth is refused (it could never let go)', () => {
    expect(codes(withParts([...base, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }, { part: 'frame', x: 0, y: 3 }]))).toContain('BAD_RECIPE');
    const lid = [...base, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' }, { part: 'frame', x: -1, y: 7 }, { part: 'frame', x: 0, y: 7 }, { part: 'frame', x: 1, y: 7 }];
    // A column of frames fills the hollow and meets the lid; a missile-up's seeker (no N face) does not.
    expect(validateBlueprint(withParts(lid, { format: 1, name: 'col', grid: ['F', 'F', 'F', 'F', 'C'] }), registry).issues.find((i) => i.code === 'BAD_RECIPE')?.message).toMatch(/would attach to frame@0,7 across its mouth/);
    expect(codes(withParts(lid))).not.toContain('BAD_RECIPE');
  });

  it('picking what a bay makes gives an untagged bay a free tag', async () => {
    const { setPartsMakes } = await import('../src/blueprint/edit');
    const bp = validateBlueprint(withParts([...base, { part: 'frame', x: 2, y: 0, tags: ['bay'] }, { part: 'fabbay', x: 0, y: 1 }]), registry).blueprint!;
    const recipe = validateBlueprint(missileUp, registry).blueprint!;
    const out = setPartsMakes(bp, ['fabbay@0,1'], { name: 'missile-up', blueprint: recipe });
    expect(out.parts.find((p) => p.id === 'fabbay@0,1')?.tags[0]).toBe('bayB');
  });

  it('tells once when a finished build cannot be placed', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const r = w.spawnBlueprint(bayBot({ format: 1, name: 'lump', grid: ['F'] }), { x: -100, y: 0.5 });
    for (let t = 0; t < 60; t++) w.step();
    w.step(tap(r.id, 'r'));
    w.step(lift(r.id, 'r'));
    for (let t = 0; t < 300; t++) w.step();
    expect(events(w, 'buildBlocked')).toMatchObject([{ part: 'fabbay@0,1', why: 'something is in its hollow' }]);
    w.dispose();
  });

  it('a bay destroyed while holding lets its copy go (as a decoupler does), and a wreck builds nothing', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    for (let t = 0; t < 260; t++) w.step();
    expect(w.partOutput(r.id, 'fabbay@0,1', 'ready')).toBe(1);
    const bay = r.parts.get('fabbay@0,1');
    if (bay) bay.health = 0;
    w.step();
    expect(events(w, 'coreWoke')).toHaveLength(1);
    // A wreck: its core gone, its bay keeps nothing going.
    const w2 = await World.create({ seed: 1 }, flat);
    const r2 = w2.spawnBlueprint(bayBot(), { x: -100, y: 0.5 });
    const core = r2.parts.get('core@0,0');
    if (core) core.health = 0;
    for (let t = 0; t < 400; t++) w2.step();
    expect(events(w2, 'built')).toHaveLength(0);
    w.dispose();
    w2.dispose();
  });
});

describe('stretchy bays (M12, Logan: sized where placed)', () => {
  it('a cup footprint: floor, walls, a hollow of any size; mass per cell', async () => {
    const { cupFootprint, footprintOf, partMass, defaultSize } = await import('../src/parts/footprint');
    const bay = registry.get('fabbay');
    expect(defaultSize(bay)).toEqual([1, 5]);
    expect(footprintOf(bay, [1, 5])).toBe(bay.footprint);
    const big = footprintOf(bay, [2, 6]);
    expect(big).toHaveLength(2 + 2 + 12);
    expect(partMass(bay, big)).toBe(16);
    expect(hollowCells(bay, [2, 6])).toHaveLength(12);
    expect(cupFootprint(1, 5)).toHaveLength(13);
  });

  it('validates sizes: only on a stretchy part, within its range', () => {
    const codes = (raw: unknown): string[] => validateBlueprint(raw, registry).issues.filter((i) => i.severity === 'error').map((i) => i.code);
    const sized = (size: unknown): Record<string, unknown> => ({ ...bayBot(), parts: [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: -1, y: 0 }, { part: 'densebattery', x: 1, y: 0 }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item', size }] });
    expect(codes(sized([2, 6]))).toEqual([]);
    expect(codes(sized([9, 6]))).toContain('BAD_SIZE');
    expect(codes(sized([0, 6]))).toContain('BAD_FORMAT');
    expect(codes({ format: 1, name: 'x', parts: [{ part: 'frame', x: 0, y: 0, size: [2, 2] }] })).toContain('BAD_SIZE');
  });

  it('a 2 by 6 bay builds a big missile, and saves and reloads at its size', async () => {
    const bigMissile = resolveScripts(JSON.parse(bpFile('big-missile.json')), bpFile).raw;
    const raw = { ...bayBot(bigMissile), parts: [{ part: 'core', x: 0, y: 0 }, { part: 'densebattery', x: -1, y: 0 }, { part: 'densebattery', x: 1, y: 0 }, { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item', size: [2, 6] }] };
    const v = validateBlueprint(raw, registry);
    expect(v.ok).toBe(true);
    const again = validateBlueprint(toFileJson(v.blueprint!, registry, { inlineScripts: true }), registry);
    expect(again.blueprint?.parts.find((p) => p.part === 'fabbay')?.size).toEqual([2, 6]);
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(raw, { x: -100, y: 0.5 });
    for (let t = 0; t < 12 * 60; t++) w.step();
    expect(events(w, 'built')).toHaveLength(1);
    expect(w.partOutput(r.id, 'fabbay@0,1', 'ready')).toBe(1);
    w.dispose();
  });

  it('mirrors an even-width bay onto the mirrored cells', async () => {
    const { orientRaw } = await import('../src/blueprint/orient');
    const { partCells } = await import('../src/assembly/assemble');
    const raw = { format: 1, name: 'x', parts: [{ part: 'core', x: 0, y: 0 }, { part: 'fabbay', x: 0, y: 1, size: [2, 3] }] };
    const cellsOf = (b: unknown): string[] => {
      const bp = validateBlueprint(b, registry).blueprint!;
      return bp.parts.flatMap((p) => partCells(p, registry).map((c) => `${c.cell.x},${c.cell.y}`)).sort();
    };
    const before = cellsOf(raw);
    const flipped = cellsOf(orientRaw(raw, { flip: true }, registry));
    // Flipped across the core's column (x 0): every cell x goes to -x.
    expect(flipped).toEqual(before.map((k) => { const [x, y] = k.split(',').map(Number); return `${-(x as number) + 0},${y}`; }).sort());
  });
});

describe('stretchy bays: review fixes (M12)', () => {
  it('an unknown part with a size is reported, not thrown', () => {
    const v = validateBlueprint({ format: 1, name: 'x', parts: [{ part: 'fabbayy', x: 0, y: 0, size: [2, 2] }] }, registry);
    expect(v.issues.map((i) => i.code)).toContain('UNKNOWN_PART');
  });

  it('mirroring a sized bay at every rotation lands on the reflected cells', async () => {
    const { mirrorBlueprint } = await import('../src/blueprint/mirror');
    const { partCells } = await import('../src/assembly/assemble');
    for (const rot of [0, 90, 180, 270]) {
      const bp = validateBlueprint({ format: 1, name: 'x', parts: [{ part: 'fabbay', x: 0, y: 0, rot, size: [3, 2] }] }, registry).blueprint!;
      const cells = (b: typeof bp): string[] => b.parts.flatMap((p) => partCells(p, registry).map((c) => `${c.cell.x},${c.cell.y}`)).sort();
      const mirrored = cells(mirrorBlueprint(bp, 0, registry));
      expect(mirrored, `rot ${rot}`).toEqual(cells(bp).map((k) => { const [x, y] = k.split(',').map(Number); return `${-(x as number) + 0},${y}`; }).sort());
    }
  });

  it('setPartsSize resizes each from its own size, and the default size is stored as none', async () => {
    const { setPartsSize } = await import('../src/blueprint/edit');
    const bp = validateBlueprint({ format: 1, name: 'x', parts: [{ part: 'fabbay', x: 0, y: 0 }, { part: 'fabbay', x: 5, y: 0, size: [2, 5] }] }, registry).blueprint!;
    const grown = setPartsSize(bp, ['fabbay@0,0', 'fabbay@5,0'], ([w, h]) => [w + 1, h], registry);
    expect(grown.parts.map((p) => p.size)).toEqual([[2, 5], [3, 5]]);
    const back = setPartsSize(grown, ['fabbay@0,0'], ([w, h]) => [w - 1, h], registry);
    expect(back.parts[0]?.size).toBeUndefined();
  });

  it('parse: a stretchy def must list a cup of its mass, open to the N', async () => {
    const { parsePartDef } = await import('../src/parts/parsePartDef');
    const raw = JSON.parse(readFileSync(new URL('../src/parts/defs/fabbay.json', import.meta.url), 'utf8'));
    expect(() => parsePartDef({ ...raw, mass: 12 }, 'x.json')).toThrow(/massPerCell times its default cells \(13\)/);
    expect(() => parsePartDef({ ...raw, acts: 'E' }, 'x.json')).toThrow(/must be N/);
    expect(() => parsePartDef({ ...raw, footprint: raw.footprint.slice(0, 12), mass: 12 }, 'x.json')).toThrow(/must be a cup/);
  });
});
