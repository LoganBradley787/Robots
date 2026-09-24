import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { placeBlueprint } from '../src/blueprint/place';
import { resolveScripts, assignScriptFiles, scriptFiles } from '../src/blueprint/scripts';
import { toFileJson } from '../src/blueprint/serialize';
import { removeParts } from '../src/blueprint/edit';
import type { Blueprint } from '../src/blueprint/types';
import { validateBlueprint } from '../src/blueprint/validate';
import { scopedView } from '../src/control/target';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(raw: unknown): Blueprint {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

// A missile: thruster on top, core, warhead below. Its own binding and script name its parts by tag.
const missile = bp({
  format: 1,
  name: 'missile',
  grid: ['M', 'C', 'X'],
  legend: { M: { part: 'thruster', rot: 180, tags: ['motor'], auto: false } },
  bindings: [
    { key: 'x', mode: 'pulse', target: 'warhead', channel: 'detonate', value: 1 },
    { key: 'g', mode: 'hold', target: 'motor', channel: 'throttle', value: 1 },
  ],
  scripts: [{ id: 'guide', source: "function tick() { set('motor', 'throttle', 1); }" }],
});

// A car with a frame roof to hang things on.
const car = bp({ format: 1, name: 'car', grid: ['F  F  F  F', 'F  C  B  F', 'W  .  .  W'] });

describe('placeBlueprint', () => {
  it('lands the source root on the cell, tags its parts with a scope, and moves its controls to its core', () => {
    const r = placeBlueprint(car, missile, { x: 1, y: 4 }, reg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scope).toBe('missile1');
    const placed = r.blueprint.parts.slice(car.parts.length);
    expect(placed.map((p) => [p.id, p.x, p.y])).toEqual([
      ['thruster@1,5', 1, 5],
      ['core@1,4', 1, 4],
      ['warhead@1,3', 1, 3],
    ]);
    expect(placed[0]?.tags).toEqual(['missile1', 'missile1.motor', 'thruster@1,5']);
    expect(placed[0]?.auto).toBe(false);
    expect(r.blueprint.bindings).toEqual(car.bindings);
    expect(r.blueprint.primaryCore).toBe('core@1,1');
    expect(r.blueprint.cores).toEqual([
      {
        core: 'core@1,4',
        scope: 'missile1',
        bindings: missile.bindings,
        scripts: [{ id: 'guide', enabled: true, params: {}, source: "function tick() { set('motor', 'throttle', 1); }" }],
      },
    ]);
  });

  it('numbers a second copy and keeps the two apart', () => {
    const one = placeBlueprint(car, missile, { x: 0, y: 4 }, reg);
    if (!one.ok) throw new Error(one.error);
    const two = placeBlueprint(one.blueprint, missile, { x: 3, y: 4 }, reg);
    if (!two.ok) throw new Error(two.error);
    expect(two.scope).toBe('missile2');
    const v = validateBlueprint(toFileJson(two.blueprint, reg, { inlineScripts: true }), reg);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // Each copy's `motor` means its own thruster only.
    const second = two.blueprint.cores?.[1];
    const reached = two.blueprint.parts.filter((p) => scopedView(p, second?.scope).tags.includes('motor')).map((p) => p.id);
    expect(reached).toEqual(['thruster@3,5']);
  });

  it('turns and mirrors around the root cell', () => {
    const side = bp({ format: 1, name: 's', grid: ['C  T>'] });
    const turned = placeBlueprint(car, side, { x: 5, y: 1 }, reg, { rot: 90 });
    if (!turned.ok) throw new Error(turned.error);
    const t = turned.blueprint.parts.at(-1);
    expect([t?.x, t?.y, t?.rot]).toEqual([5, 2, (270 + 90) % 360]);
    const flipped = placeBlueprint(car, side, { x: 6, y: 1 }, reg, { mirror: true });
    if (!flipped.ok) throw new Error(flipped.error);
    const f = flipped.blueprint.parts.at(-1);
    // T> is rot 270 (pushes right); mirrored it sits left of the core and pushes left.
    expect([f?.x, f?.y, f?.rot]).toEqual([5, 1, 90]);
  });

  it('lands a core-less source on its first part and leaves its controls out with a warning', () => {
    const pod = bp({ format: 1, name: 'pod', grid: ['P  F  P'], bindings: [{ key: 'p', mode: 'hold', target: 'propeller', channel: 'lift', value: 1 }] });
    const r = placeBlueprint(car, pod, { x: 0, y: 3 }, reg);
    if (!r.ok) throw new Error(r.error);
    expect(r.blueprint.parts.slice(car.parts.length).map((p) => p.id)).toEqual(['propeller@0,3', 'frame@1,3', 'propeller@2,3']);
    expect(r.blueprint.cores).toBeUndefined();
    expect(r.warnings[0]).toMatch(/no core/);
  });

  it('refuses overlaps', () => {
    const r = placeBlueprint(car, missile, { x: 1, y: 2 }, reg);
    expect(r).toEqual({ ok: false, error: 'missile would overlap frame@1,2 at (1, 2)' });
  });

  it('copies everything as it is onto a robot with no core yet, renaming id targets', () => {
    const byId = bp({ format: 1, name: 'b', grid: ['C  T>'], bindings: [{ key: 'f', mode: 'hold', target: 'thruster@1,0', channel: 'throttle', value: 1 }] });
    const r = placeBlueprint(bp({ format: 1, name: 'blank', parts: [] }), byId, { x: 4, y: 4 }, reg);
    if (!r.ok) throw new Error(r.error);
    expect(r.scope).toBeUndefined();
    expect(r.blueprint.bindings[0]?.target).toBe('thruster@5,4');
    expect(r.blueprint.parts.map((p) => p.tags)).toEqual([['core@4,4'], ['thruster@5,4']]);
  });

  it('carries a placed robot’s other cores along, nesting their scopes', () => {
    const launcher = placeBlueprint(car, missile, { x: 1, y: 4 }, reg);
    if (!launcher.ok) throw new Error(launcher.error);
    const truck = bp({ format: 1, name: 'truck', grid: ['C  F  F  F  F  F  F'] });
    const r = placeBlueprint(truck, { ...launcher.blueprint, name: 'launcher' }, { x: 3, y: 2 }, reg);
    if (!r.ok) throw new Error(r.error);
    expect(r.blueprint.cores?.map((c) => [c.core, c.scope])).toEqual([
      ['core@3,2', 'launcher1'],
      ['core@3,5', 'launcher1.missile1'],
    ]);
    const thruster = r.blueprint.parts.find((p) => p.id === 'thruster@3,6');
    expect(scopedView(thruster as never, 'launcher1.missile1')).toEqual({ part: 'thruster', tags: ['thruster@3,6', 'motor'] });
    // Outside its scope a part keeps its id and type, and its tags are hidden.
    expect(scopedView({ ...(r.blueprint.parts[1] as object), tags: ['frame@1,0', 'body'] } as never, 'launcher1.missile1')).toEqual({ part: 'frame', tags: ['frame@1,0'] });
  });

  it('needs scripts loaded', () => {
    const unloaded = bp({ format: 1, name: 'u', grid: ['C'], scripts: [{ id: 's', source: { file: 'u.s.js' } }] });
    expect(placeBlueprint(car, unloaded, { x: 0, y: 4 }, reg)).toEqual({ ok: false, error: "u: script 's' was not loaded from its file" });
  });
});

describe('controls per core in files', () => {
  const placed = placeBlueprint(car, missile, { x: 1, y: 4 }, reg);
  if (!placed.ok) throw new Error(placed.error);

  it('round trips through the file form, scripts saved under the core’s name', () => {
    const named = assignScriptFiles(placed.blueprint, 'launcher.json', true);
    expect(named.cores?.[0]?.scripts[0]?.file).toBe('launcher.missile1.guide.js');
    const file = toFileJson(named, reg);
    expect(file.cores).toEqual({
      'core@1,4': { scope: 'missile1', bindings: missile.bindings, scripts: [{ id: 'guide', source: { file: 'launcher.missile1.guide.js' } }] },
    });
    expect(scriptFiles(named)).toEqual([{ file: 'launcher.missile1.guide.js', text: "function tick() { set('motor', 'throttle', 1); }" }]);
    const back = resolveScripts(JSON.parse(JSON.stringify(file)), (f) => (f === 'launcher.missile1.guide.js' ? 'code' : undefined));
    expect(back.missing).toEqual([]);
    const again = bp(back.raw);
    expect(again.cores?.[0]?.scripts[0]).toEqual({ id: 'guide', enabled: true, params: {}, source: 'code', file: 'launcher.missile1.guide.js' });
    expect(toFileJson(again, reg)).toEqual(file);
  });

  it('validates each core’s bindings in its scope', () => {
    const wrong = { ...placed.blueprint, cores: [{ ...(placed.blueprint.cores?.[0] as never as object), bindings: [{ key: 'h', mode: 'hold', target: 'roof', channel: 'lift', value: 1 }] }] } as Blueprint;
    const v = validateBlueprint(toFileJson(wrong, reg, { inlineScripts: true }), reg);
    expect(v.issues.map((i) => i.code)).toContain('BAD_TARGET');
    expect(v.issues.find((i) => i.code === 'BAD_TARGET')?.message).toMatch(/^core core@1,4 \(missile1\): binding key 'h' targets 'roof'/);
  });

  it('refuses controls for a part that is not a core, or for the primary core', () => {
    const raw = { format: 1, name: 't', grid: ['C  C'], cores: { 'frame@9,9': {}, 'core@0,0': {} } };
    const codes = validateBlueprint(raw, reg).issues.filter((i) => i.code === 'BAD_CORE_CONTROLS').map((i) => i.message);
    expect(codes).toEqual([
      "cores lists 'frame@9,9', which is not a core in this blueprint",
      'cores lists core@0,0, the primary core; its controls are the top-level bindings and scripts',
    ]);
  });

  it('shape-checks cores', () => {
    expect(expandBlueprint({ format: 1, name: 't', grid: ['C'], cores: [] }).issues[0]?.code).toBe('BAD_FORMAT');
    expect(expandBlueprint({ format: 1, name: 't', grid: ['C'], cores: { 'core@0,0': { wat: 1 } } }).issues[0]?.message).toMatch(/unknown field 'wat'/);
    expect(expandBlueprint({ format: 1, name: 't', grid: ['C'], cores: { 'core@0,0': { bindings: [{ key: 'a' }] } } }).issues[0]?.path).toBe('cores.core@0,0.bindings[0]');
  });

  it('erasing a core drops its controls', () => {
    expect(removeParts(placed.blueprint, ['core@1,4']).cores).toBeUndefined();
  });
});
