import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import arenaJson from '../../../worlds/arena.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { PartInstance, Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';

/**
 * titan-mirage-rw's repair script, one decision at a time. Each scene flies the hull with no enemy, hurts it by hand
 * (health 0, so parts go as if shot), and lets the script get on with it. Slow for a test (about 2 s of wall clock a
 * scene), so only what a change could quietly break.
 * Measured when written: 188 propellers off the bow, it stopped at 472 with lift at 1.3 times its weight, never lower than
 * 198 m; 161 off the stern put it on the ground and it climbed back to 200 m in 35 s.
 */
const arena = parseWorldFile(arenaJson);
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const raw = resolveScripts(JSON.parse(bpFile('titan-mirage-rw.json')), bpFile).raw as Record<string, unknown>;
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

async function flying(): Promise<{ w: World; r: Robot }> {
  const w = await World.create({ seed: 1, scripts: host }, arena);
  const r = w.spawnBlueprint(raw, { x: -400, y: 150 }, { team: 0 });
  for (let i = 0; i < 20 * 60; i++) w.step();
  return { w, r };
}
const hull = (r: Robot): PartInstance[] => [...r.parts.values()].filter((p) => !/^g.\d/.test(p.tags[0] ?? ''));
const shoot = (r: Robot, match: (p: PartInstance) => boolean): string[] => {
  const hit = hull(r).filter(match);
  for (const p of hit) p.health = 0;
  return hit.map((p) => p.id);
};
const steps = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step();
};
const count = (r: Robot, type: string): number => hull(r).filter((p) => p.def.id === type).length;

describe('titan-mirage-rw: the repair script', () => {
  it('sells what holds nothing up for a float, and leaves the keep alone', async () => {
    const { w, r } = await flying();
    expect(r.repair?.tank).toBeGreaterThanOrEqual(25);
    expect(count(r, 'densebattery')).toBeGreaterThan(190);
    expect(count(r, 'armorplate')).toBe(53);
    w.dispose();
  }, 240000);

  it('the keep breached: what was lost round the core comes back, plates healed', async () => {
    const { w, r } = await flying();
    const gone = shoot(r, (p) => p.x >= 3 && p.x <= 5 && p.y >= 4 && p.y <= 11 && p.def.id !== 'core');
    expect(gone.length).toBeGreaterThan(15);
    steps(w, 30);
    for (const id of gone) expect(r.parts.has(id)).toBe(true);
    const plates = gone.flatMap((id) => (id.startsWith('armorplate') ? [r.parts.get(id) as PartInstance] : []));
    for (const p of plates) expect(p.health / p.def.health).toBeGreaterThan(0.7);
    w.dispose();
  }, 240000);

  it('the link nearly cut: the hull comes back before anything else is asked for', async () => {
    const { w, r } = await flying();
    const gone = shoot(r, (p) => p.x >= 40 && p.x <= 42 && p.y >= 1 && p.y <= 7 && p.def.id !== 'propeller');
    steps(w, 8);
    for (const id of gone) expect(r.parts.has(id)).toBe(true);
    w.dispose();
  }, 240000);

  it('a third of its lift off the bow: it stays up, level, and makes back what it wants', async () => {
    const { w, r } = await flying();
    shoot(r, (p) => p.def.id === 'propeller' && p.x >= 110);
    let low = Infinity;
    for (let i = 0; i < 40 * 60; i++) {
      w.step();
      low = Math.min(low, partWorldPose(w, r, r.primaryCoreId as string).y);
    }
    expect(low).toBeGreaterThan(150);
    expect(count(r, 'propeller')).toBeGreaterThan(460);
    w.dispose();
  }, 240000);

  it('a bay gone: it pays for one, far side first, and it fires again', async () => {
    const { w, r } = await flying();
    const bays = hull(r).filter((p) => p.def.id === 'fabbay').sort((a, b) => a.x - b.x);
    const bay = bays[9] as PartInstance;
    bay.health = 0;
    steps(w, 50);
    expect(r.parts.has(bay.id)).toBe(true);
    expect((r.parts.get(bay.id) as PartInstance).built).toBeGreaterThan(0);
    w.dispose();
  }, 240000);
});
