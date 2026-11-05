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

/** The same robot with some of its repair params changed. */
const withRepair = (params: Record<string, number>): Record<string, unknown> => ({
  ...raw,
  scripts: (raw.scripts as { id: string; params?: Record<string, number> }[]).map((s) => (s.id === 'repair' ? { ...s, params: { ...s.params, ...params } } : s)),
});

async function flying(blueprint: Record<string, unknown> = raw): Promise<{ w: World; r: Robot }> {
  const w = await World.create({ seed: 1, scripts: host }, arena);
  const r = w.spawnBlueprint(blueprint, { x: -400, y: 150 }, { team: 0 });
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
/** Down to the six bays nearest the core, the floor. */
const sixBays = (r: Robot): void => {
  const core = r.parts.get(r.primaryCoreId as string) as PartInstance;
  const bays = hull(r).filter((p) => p.def.id === 'fabbay').sort((a, b) => Math.abs(a.x - core.x) - Math.abs(b.x - core.x));
  for (const p of bays.slice(6)) p.health = 0;
};

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
    expect(count(r, 'propeller')).toBeGreaterThan(440);
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

  it('down with nothing else to sell: it goes under the bay floor and flies again', async () => {
    const { w, r } = await flying(withRepair({ minDense: 300, float: 0 }));
    sixBays(r);
    steps(w, 2);
    shoot(r, (p) => p.def.id === 'propeller' && p.x >= 25);
    steps(w, 0.1);
    const left = count(r, 'propeller');
    steps(w, 50);
    expect(count(r, 'fabbay')).toBeLessThan(6);
    expect(count(r, 'propeller')).toBeGreaterThan(left + 80);
    steps(w, 70);
    expect(partWorldPose(w, r, r.primaryCoreId as string).y).toBeGreaterThan(100);
    w.dispose();
  }, 240000);

  it('barely enough lift held level is enough: the helm does not step down past it', async () => {
    const { w, r } = await flying(withRepair({ repair: 0 }));
    shoot(r, (p) => p.x > 140);
    let low = Infinity;
    for (let i = 0; i < 40 * 60; i++) {
      w.step();
      low = Math.min(low, partWorldPose(w, r, r.primaryCoreId as string).y);
    }
    expect(low).toBeGreaterThan(150);
    w.dispose();
  }, 240000);

  it('cut near the stern block: it comes down level and lands on its belly', async () => {
    const { w, r } = await flying(withRepair({ repair: 0 }));
    shoot(r, (p) => p.x > 60);
    steps(w, 30);
    expect(Math.abs(partWorldPose(w, r, r.primaryCoreId as string).angle)).toBeLessThan(0.3);
    w.dispose();
  }, 240000);

  it('short for a want: the stern block pays first, and the rows that join the core to the hull stay', async () => {
    const { w, r } = await flying(withRepair({ float: 0, sellTo: 3 }));
    shoot(r, (p) => p.def.id === 'armorplate' && p.y === 11 && p.x >= 3 && p.x <= 9);
    steps(w, 15);
    const sold = w.events.flatMap((e) => (e.kind === 'partScrapped' && e.partType === 'densebattery' ? [e.part] : []));
    expect(sold.length).toBeGreaterThan(5);
    for (const id of sold) expect(Number(/@(-?\d+),/.exec(id)?.[1])).toBeLessThan(12);
    for (const id of ['densebattery@9,6', 'densebattery@3,6']) expect(r.parts.has(id)).toBe(true);
    expect(r.parts.size).toBeGreaterThan(1200);
    w.dispose();
  }, 240000);

  it('poor with lift to spare: it sells the far end a column at a time, and stays up', async () => {
    const { w, r } = await flying(withRepair({ minDense: 300, float: 0, sellTo: 3 }));
    shoot(r, (p) => p.def.id === 'propeller' && p.x >= 60 && p.x <= 100 && p.y === 2);
    let low = Infinity;
    for (let i = 0; i < 25 * 60; i++) {
      w.step();
      low = Math.min(low, partWorldPose(w, r, r.primaryCoreId as string).y);
    }
    expect(Math.max(...hull(r).map((p) => p.x))).toBeLessThan(175);
    expect(w.events.some((e) => e.kind === 'partScrapped' && e.partType === 'frame')).toBe(true);
    expect(low).toBeGreaterThan(150);
    w.dispose();
  }, 240000);

  it('under its own weight: it sells plates off the core for weight, never the walls round it or level with it', async () => {
    const { w, r } = await flying();
    // All its lift right of column 20 (column 70 until 2026-11-05: with scrapping at full price its batteries alone
    // bought that lift back, and it sold no plate).
    shoot(r, (p) => p.def.id === 'propeller' && p.x >= 20);
    steps(w, 6);
    const sold = w.events.flatMap((e) => (e.kind === 'partScrapped' && e.robot === r.id && e.partType === 'armorplate' ? [e.part] : []));
    expect(sold.length).toBeGreaterThan(5);
    for (const id of sold) {
      const [x, y] = (/@(-?\d+),(-?\d+)/.exec(id) ?? []).slice(1).map(Number) as [number, number];
      expect(Math.abs(x - 6) > 3 && Math.abs(y - 6) > 2).toBe(true);
    }
    expect(w.robots.filter((x) => x !== r && x.parts.size > 20)).toHaveLength(0);
    w.dispose();
  }, 240000);

  it('a bay it made: while it can hold itself up, it sells an older one first, and makes no more', async () => {
    const { w, r } = await flying(withRepair({ minDense: 300, float: 300, sellTo: 3 }));
    sixBays(r);
    r.repair = { tank: 60, jobs: [] };
    steps(w, 45);
    // How many it makes depends on how fast a bay is made (one at the classic speed, more near instant).
    const made = w.events.flatMap((e) => (e.kind === 'partRebuilt' && e.partType === 'fabbay' ? [e.part] : []));
    expect(made.length).toBeGreaterThan(0);
    expect(count(r, 'fabbay')).toBe(6 + made.length);
    shoot(r, (p) => (p.x >= 3 && p.x <= 5 && p.y >= 4 && p.y <= 11 && p.def.id !== 'core') || (p.def.id === 'armorplate' && p.y === 1 && p.x >= 3 && p.x <= 9));
    r.repair.tank = 0;
    steps(w, 40);
    const sales = w.events.filter((e) => e.kind === 'partScrapped' && e.partType === 'fabbay') as { tick: number; part: string }[];
    expect(sales.length).toBeGreaterThan(0);
    for (const id of made) expect(sales.map((e) => e.part)).not.toContain(id);
    const firstSale = (sales[0] as { tick: number }).tick;
    expect(w.events.filter((e) => e.kind === 'partRebuilt' && e.partType === 'fabbay' && e.tick > firstSale)).toHaveLength(0);
    w.dispose();
  }, 240000);
});
