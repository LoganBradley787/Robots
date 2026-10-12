import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readdirSync, readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { expandBlueprint } from '../src/blueprint/expand';
import { isCore, partCells, rootPartId } from '../src/assembly/assemble';
import { mirrorProblem } from '../src/blueprint/mirror';
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

describe('flipping keeps the root part where it is (review E5)', () => {
  const stock = readdirSync(new URL('../../../blueprints/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.slice(0, -'.json'.length), bp: expand(JSON.parse(bpFile(f))) }));
  const rootCells = (bp: Blueprint): string[] => {
    const root = bp.parts.find((p) => p.id === rootPartId(bp, reg));
    return root ? partCells(root, reg).map((c) => `${c.cell.x},${c.cell.y}`).sort() : [];
  };

  it('a two-wide root flips onto its own cells, and flipping twice gives the blueprint back', () => {
    // The cannon is two cells wide: its origin is its left column, so its mirror image is not about that column.
    const bp = expand(JSON.parse(bpFile('cannon-turret.json')));
    expect(bp.parts[0]?.part).toBe('cannon');
    const once = orientBlueprint(bp, { flip: true }, reg);
    expect(rootCells(once)).toEqual(rootCells(bp));
    expect(orientBlueprint(once, { flip: true }, reg).parts).toEqual(bp.parts);
    // Upside down it keeps its cells too. On its side its two columns are two rows and its barrel swings to the
    // other side of its origin's column, as a one-cell gun's does; two flips still give the blueprint back.
    const down = orientBlueprint(bp, { rot: 180 }, reg);
    expect(rootCells(orientBlueprint(down, { flip: true }, reg))).toEqual(rootCells(down));
    for (const rot of [90, 180, 270] as const) {
      const turned = orientBlueprint(bp, { rot }, reg);
      expect(orientBlueprint(orientBlueprint(turned, { flip: true }, reg), { flip: true }, reg).parts).toEqual(turned.parts);
    }
  });

  it('every stock blueprint comes back from two flips, and from four quarter turns', () => {
    expect(stock.length).toBeGreaterThanOrEqual(90);
    const multiCellRoots: string[] = [];
    for (const { name, bp } of stock) {
      const root = bp.parts.find((p) => p.id === rootPartId(bp, reg));
      if (root && !isCore(root, reg) && partCells(root, reg).length > 1) multiCellRoots.push(name);
      let turned = bp;
      for (let i = 0; i < 4; i++) turned = orientBlueprint(turned, { rot: 90 }, reg);
      expect(turned.parts, `${name} turned four times`).toEqual(bp.parts);
      if (mirrorProblem(bp, reg)) continue;
      expect(orientBlueprint(orientBlueprint(bp, { flip: true }, reg), { flip: true }, reg).parts, `${name} flipped twice`).toEqual(bp.parts);
    }
    // Of the stock blueprints only the cannon turret has a multi-cell first part and no core; the lance and laser
    // turrets start with their rotator. The next test covers those guns as roots.
    expect(multiCellRoots).toContain('cannon-turret');
  });

  it('a cannon, a lance or a laser as the root comes back from two flips, whichever way it points', () => {
    for (const part of ['cannon', 'lance', 'laser']) {
      for (const rot of [0, 90, 180, 270] as const) {
        const bp = expand({ format: 1, name: 'g', parts: [{ part, x: 5, y: 5, rot }, { part: 'frame', x: 9, y: 9 }, { part: 'thruster', x: 10, y: 9, rot: 90 }] });
        const once = orientBlueprint(bp, { flip: true }, reg);
        expect(orientBlueprint(once, { flip: true }, reg).parts, `${part} at ${rot}`).toEqual(bp.parts);
        if (rot === 0 || rot === 180) expect(rootCells(once), `${part} at ${rot}`).toEqual(rootCells(bp));
      }
    }
  });

  it('a bay as the root flips onto its own cells at every size', () => {
    for (const size of [undefined, [1, 1], [2, 3], [4, 2]] as const) {
      const bp = expand({ format: 1, name: 'b', parts: [{ part: 'fabbay', x: 3, y: 2, ...(size ? { size } : {}) }, { part: 'frame', x: 3, y: 1 }, { part: 'thruster', x: 2, y: 1, rot: 90 }] });
      const once = orientBlueprint(bp, { flip: true }, reg);
      expect(rootCells(once)).toEqual(rootCells(bp));
      expect(orientBlueprint(once, { flip: true }, reg).parts).toEqual(bp.parts);
    }
  });
});
