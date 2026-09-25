import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { expandBlueprint } from '../src/blueprint/expand';
import { orientBlueprint, orientRaw } from '../src/blueprint/orient';
import { resolveScripts } from '../src/blueprint/scripts';
import { validateBlueprint } from '../src/blueprint/validate';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const shipped = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

function expand(raw: unknown): Blueprint {
  const r = expandBlueprint(raw);
  if (!r.blueprint) throw new Error('should expand');
  return r.blueprint;
}

describe('orientBlueprint (M8 deploy flip and turn)', () => {
  it('no flip and no turn returns the blueprint itself', () => {
    const bp = expand(carJson);
    expect(orientBlueprint(bp, {}, reg)).toBe(bp);
  });

  it('flips across the root part column and mirrors part rotations', () => {
    const bp = expand({ format: 1, name: 't', grid: ['C  F  T>'] });
    const out = orientBlueprint(bp, { flip: true }, reg);
    expect(out.parts.map((p) => [p.id, p.x, p.y, p.rot])).toEqual([
      ['core@0,0', 0, 0, 0],
      ['frame@-1,0', -1, 0, 0],
      [`thruster@-2,0`, -2, 0, (360 - (bp.parts[2]?.rot ?? 0)) % 360],
    ]);
  });

  it('turns 90 degrees counterclockwise around the root, and part rotations turn with it', () => {
    const bp = expand({ format: 1, name: 't', grid: ['C  F  F'] });
    const out = orientBlueprint(bp, { rot: 90 }, reg);
    expect(out.parts.map((p) => [p.x, p.y, p.rot])).toEqual([
      [0, 0, 90],
      [0, 1, 90],
      [0, 2, 90],
    ]);
  });

  it('binding targets, the pilot, and every core controls follow the renamed parts', () => {
    const bp = expand({
      format: 1,
      name: 't',
      grid: ['C  W  C'],
      bindings: [{ key: 'd', mode: 'hold', target: 'wheel@1,0', channel: 'speed', value: 1 }],
      cores: { 'core@2,0': { scope: 'm1', bindings: [{ key: 'a', mode: 'hold', target: 'wheel@1,0', channel: 'speed', value: 1 }] } },
    });
    const out = orientBlueprint(bp, { flip: true, rot: 180 }, reg);
    // Flip then turn 180: x -> x, y -> -y. The root stays put.
    expect(out.parts.map((p) => p.id)).toEqual(['core@0,0', 'wheel@1,0', 'core@2,0']);
    const turned = orientBlueprint(bp, { rot: 90 }, reg);
    expect(turned.parts.map((p) => p.id)).toEqual(['core@0,0', 'wheel@0,1', 'core@0,2']);
    expect(turned.bindings[0]?.target).toBe('wheel@0,1');
    expect(turned.cores?.[0]?.core).toBe('core@0,2');
    expect(turned.cores?.[0]?.bindings[0]?.target).toBe('wheel@0,1');
    expect(turned.primaryCore).toBe('core@0,0');
  });

  it('orientRaw gives a valid blueprint with its scripts inline, and leaves an invalid one alone', () => {
    const raw = orientRaw(shipped('missile-drone'), { flip: true }, reg);
    const v = validateBlueprint(raw, reg);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.blueprint?.scripts.every((s) => typeof s.source === 'string')).toBe(true);
    const bad = { format: 1, name: 'x', grid: ['?'] };
    expect(orientRaw(bad, { flip: true }, reg)).toBe(bad);
  });

  it('a flipped launcher fires its missile to the left', async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const launcher = w.spawnBlueprint(orientRaw(shipped('launcher'), { flip: true }, reg), { x: 100, y: 1.5 });
    for (let i = 0; i < 60; i++) w.step();
    w.step([{ robot: launcher.id, pressed: ['f'], released: [] }]);
    for (let i = 0; i < 60; i++) w.step();
    const missile = w.robots.find((r) => r.brokeFrom === launcher.id) as Robot;
    expect(missile).toBeDefined();
    const core = missile.groups[missile.parts.get(missile.primaryCoreId ?? '')?.group ?? 0]?.bodyId as number;
    expect(w.physics.state(core).vx).toBeLessThan(-10);
    w.dispose();
  });
});
