import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { resolveScripts } from '../src/blueprint/scripts';
import { SIGHT } from '../src/weapons/shells';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

// The drone's hidden turrets: gun-turret3 and 5 on the left end (upper, lower), 4 and 6 on the right. Each has its
// plate one cell in front of its gun and a piston (the door) that slides it clear.
const HIDDEN_GUNS = ['gun@1,8', 'gun@1,0', 'gun@15,8', 'gun@15,0'];
const LEFT_DOORS = ['piston@0,7', 'piston@0,1'];
const RIGHT_DOORS = ['piston@16,7', 'piston@16,1'];
const door = (w: World, r: Robot, id: string): number => w.partOutput(r.id, id, 'position') ?? -1;

/** Parts a robot, or any piece that broke off it, lost. */
function partsLost(w: World, r: Robot): number {
  const family = (id: number): boolean => id === r.id || w.robots.find((x) => x.id === id)?.brokeFrom === r.id;
  return w.events.filter((e) => e.kind === 'partDestroyed' && family(e.robot) && e.burntOut !== true).length;
}

/** A popout drone at x -400 (clear of the flat world's boxes) and a low target 200 m to its right on the ground. */
async function fightAt(target: string[], seconds: number, stopAt?: (cw: World, a: Robot, t: Robot, second: number) => void) {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const a = w.spawnBlueprint(blueprint('enemy-popout-gun-drone'), { x: -400, y: 40 });
  const t = w.spawnBlueprint({ format: 1, name: 'target', grid: target }, { x: -200, y: 0.5 }, { team: 1 });
  for (let tick = 0; tick <= seconds * 60; tick++) {
    if (tick % 60 === 0) stopAt?.(w, a, t, tick / 60);
    w.step();
  }
  return { w, a, t };
}

describe('popout gun drone, done when', () => {
  it('its four hidden guns start behind their plates: the sight sees its own robot, and the doors stay shut with nothing to fight', { timeout: 60_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const a = w.spawnBlueprint(blueprint('enemy-popout-gun-drone'), { x: -400, y: 40 });
    for (let t = 0; t < 15 * 60; t++) {
      w.step();
      if (t === 60) for (const g of HIDDEN_GUNS) expect(w.partOutput(a.id, g, 'sightSide'), g).toBe(SIGHT.own);
    }
    for (const d of [...LEFT_DOORS, ...RIGHT_DOORS]) expect(door(w, a, d), d).toBe(0);
    expect(w.shotsBy(a.id)).toBe(0);
    w.dispose();
  });

  it('a target that never had guns: the doors open after 10 s of fighting, only on the target’s side', { timeout: 60_000 }, async () => {
    const { w, a } = await fightAt(['F F C F F F F F F F F F F'], 14, (cw, r, _t, second) => {
      // Batch: it tracks the target from the start; the doors must stay shut for the first 9 s.
      if (second === 9) for (const d of [...LEFT_DOORS, ...RIGHT_DOORS]) expect(door(cw, r, d), `${d} at 9 s`).toBe(0);
    });
    for (const d of RIGHT_DOORS) expect(door(w, a, d), d).toBe(1);
    for (const d of LEFT_DOORS) expect(door(w, a, d), d).toBe(0);
    w.dispose();
  });

  it('a target that had a gun and lost it: the doors open as soon as it is gone, well before 10 s', { timeout: 60_000 }, async () => {
    const { w, a, t } = await fightAt(['M< C F F F F F F F F F F F'], 9.5, (cw, r, target, second) => {
      // Every second while the target still has its gun (how long that is shifts with the drone's weight).
      if ([...target.parts.values()].some((p) => p.def.id === 'gun')) expect(door(cw, r, 'piston@16,7'), `shut while its gun is still there (${second} s)`).toBe(0);
    });
    const gunGone = w.events.find((e) => e.kind === 'partDestroyed' && e.robot === t.id && e.partType === 'gun');
    expect(gunGone).toBeDefined();
    expect((gunGone?.tick ?? 0) / 60).toBeLessThan(9);
    for (const d of RIGHT_DOORS) expect(door(w, a, d), d).toBeGreaterThan(0.5);
    for (const d of LEFT_DOORS) expect(door(w, a, d), d).toBe(0);
    w.dispose();
  });

  it('the hidden guns fire once the doors are open: more shells leave after they open than before', { timeout: 60_000 }, async () => {
    let before = 0;
    const { w, a } = await fightAt(['F F C F F F F F F F F F F'], 30, (cw, r, _t, second) => {
      if (second === 10) before = cw.shotsBy(r.id);
    });
    // The two exposed guns hit the target for 10 s (about 10 shells a second when on target, some of it blocked);
    // the rest come from the hidden ones. A run with the doors shut fires the exposed guns only.
    expect(before).toBeGreaterThan(0);
    expect(w.shotsBy(a.id)).toBeGreaterThan(before + 20);
    w.dispose();
  });

  it('holds its own against the enemy gun drone: alive, and the other loses parts', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const popout = w.spawnBlueprint(blueprint('enemy-popout-gun-drone'), { x: -100, y: 40 });
    const enemy = w.spawnBlueprint(blueprint('enemy-gun-drone'), { x: 100, y: 40 }, { team: 1 });
    for (let t = 0; t < 45 * 60; t++) w.step();
    expect(w.events.some((e) => e.kind === 'coreLost' && e.robot === popout.id)).toBe(false);
    expect(partsLost(w, enemy)).toBeGreaterThanOrEqual(8);
    expect(partsLost(w, popout)).toBeLessThan(partsLost(w, enemy));
    w.dispose();
  });
});
