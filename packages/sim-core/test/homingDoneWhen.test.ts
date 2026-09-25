import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import type { RobotInput } from '../src/control/types';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shipped blueprint with its script files loaded. */
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

function speedOf(w: World, r: Robot): number {
  const s = w.physics.state(r.groups[0]?.bodyId as number);
  return Math.hypot(s.vx, s.vy);
}

/** Parts a robot, or any piece that broke off it, lost to damage. */
function partsLost(w: World, target: Robot): number {
  const family = new Set([target.id, ...w.robots.filter((r) => r.brokeFrom === target.id).map((r) => r.id)]);
  return w.events.filter((e) => e.kind === 'partDestroyed' && family.has(e.robot)).length;
}

/** The launcher on open ground at x = -100 with an enemy target, F pressed at 1 s; runs `seconds` in all. */
async function shoot(target: string, at: { x: number; y: number }, seconds: number, during?: (w: World, t: Robot, tick: number) => RobotInput[]): Promise<{ w: World; target: Robot; missile?: Robot }> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const launcher = w.spawnBlueprint(blueprint('launcher-seeker'), { x: -100, y: 1.45 });
  const t = w.spawnBlueprint(blueprint(target), at, { team: 1 });
  for (let tick = 0; tick < seconds * 60; tick++) {
    const inputs = during?.(w, t, tick) ?? [];
    if (tick === 60) inputs.push({ robot: launcher.id, pressed: ['f'], released: [] });
    w.step(inputs);
  }
  const missile = w.robots.find((r) => r.brokeFrom === launcher.id && r.woke);
  return { w, target: t, ...(missile ? { missile } : {}) };
}

describe('M8 seeker missiles, done when', () => {
  it('the launcher aims at a parked enemy car 80 m away, hands the missile its point, and the missile hits it', async () => {
    const { w, target, missile } = await shoot('car', { x: -20, y: 1 }, 6);
    expect(missile).toBeDefined();
    expect(w.events.some((e) => e.kind === 'explosion')).toBe(true);
    expect(partsLost(w, target)).toBeGreaterThan(0);
    w.dispose();
  });

  it('hits an enemy drone hovering 80 m away and 20 m up', async () => {
    const { w, target } = await shoot('missile-drone-10prop', { x: -20, y: 20 }, 6);
    expect(partsLost(w, target)).toBeGreaterThan(0);
    w.dispose();
  });

  it('hits the drone while it flies sideways at about 10 m/s', async () => {
    let fastest = 0;
    const { w, target } = await shoot('missile-drone-10prop', { x: -20, y: 20 }, 6, (w, t, tick) => {
      if (w.robots.includes(t)) fastest = Math.max(fastest, speedOf(w, t));
      if (tick === 30) return [{ robot: t.id, pressed: ['d'], released: [] }];
      if (tick === 90) return [{ robot: t.id, pressed: [], released: ['d'] }];
      return [];
    });
    expect(fastest).toBeGreaterThan(8);
    expect(partsLost(w, target)).toBeGreaterThan(0);
    w.dispose();
  });
});
