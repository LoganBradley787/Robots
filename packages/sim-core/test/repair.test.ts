import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World, type WorldEvent } from '../src/world/World';
import type { PartInstance, Robot } from '../src/world/Robot';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { createCost, CREATE_SHARE, healCost, jobSeconds, SCRAP_RETURN, scrapGives, START_HEALTH, TIME_SCALE, worth } from '../src/repair/numbers';
import { defaultRegistry } from '../src/parts/registry';
import { partWorldPose } from '../src/metrics/robotMetrics';
import { buildReplay, runReplay } from '../src/replay/replayFile';
import { cos, sin } from '../src/math/fdlibm';
import { resolveScripts } from '../src/blueprint/scripts';
import { readFileSync } from 'node:fs';

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
const registry = defaultRegistry();
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** A script running `orders` on the ticks they name: each is a line of script whose answer is logged as JSON. */
const script = (orders: Record<number, string>): { id: string; source: string } => ({
  id: 'pilot',
  source: `const ORDERS = { ${Object.entries(orders)
    .map(([t, code]) => `${t}: () => (${code})`)
    .join(', ')} };
function tick() { const o = ORDERS[frame]; if (o) { const r = o(); log(JSON.stringify(r === undefined ? null : r)); } }`,
});

async function run(bp: Record<string, unknown>, orders: Record<number, string>, ticks: number, opts: { y?: number; fullRebuild?: boolean; fullLayouts?: boolean } = {}): Promise<{ w: World; r: Robot }> {
  const w = await World.create({ seed: 1, scripts: host, ...(opts.fullRebuild ? { fullRebuild: true } : {}), ...(opts.fullLayouts ? { fullLayouts: true } : {}) }, open);
  const r = w.spawnBlueprint({ format: 1, name: 'bot', ...bp, scripts: [script(orders)] }, { x: 0, y: opts.y ?? 0.6 });
  for (let i = 0; i < ticks; i++) w.step();
  return { w, r };
}

/** What the orders answered; a script's warning lines are not answers. */
const answers = (w: World): unknown[] => w.scriptLogs.filter((l) => !l.text.startsWith('lost()')).map((l) => JSON.parse(l.text) as unknown);
const kinds = (w: World, kind: WorldEvent['kind']): WorldEvent[] => w.events.filter((e) => e.kind === kind);
const live = (r: Robot): string[] => [...r.parts.keys()];
const order = (r: Robot): string[] => r.blueprint.parts.filter((p) => r.parts.has(p.id)).map((p) => p.id);
/** How many ticks a job of these seconds takes, one more so its order's tick is counted. */
const ticks = (seconds: number): number => Math.ceil(seconds * 60) + 2;
const SCRAP_FRAME = jobSeconds(registry.get('frame')) * 0.5;
const BUILD_FRAME = jobSeconds(registry.get('frame'));
const LINE = { grid: ['F  F  C  F  F'] };

describe('repair prices', () => {
  it('holds to Logan\'s checks', () => {
    // A part at 40 percent healed to full costs 30 percent of its worth.
    expect(healCost(10, 0.6)).toBeCloseTo(3, 10);
    // Scrapping a part at zero health returns 40 percent of its worth.
    expect(scrapGives(10, 0)).toBeCloseTo(4, 10);
    expect(scrapGives(10, 1)).toBeCloseTo(10 * SCRAP_RETURN, 10);
    expect(createCost(10)).toBeCloseTo(10 * CREATE_SHARE, 10);
    expect(jobSeconds(registry.get('reactor'))).toBeCloseTo(registry.get('reactor').build! * TIME_SCALE, 10);
    expect(jobSeconds(registry.get('laser'))).toBe(6);
    expect(jobSeconds(registry.get('propeller'))).toBeCloseTo(0.6, 10);
  });

  it('a part is worth its mass unless its def names its own juice', () => {
    expect(worth(registry.get('propeller'))).toBe(1);
    expect(worth(registry.get('armorplate'))).toBe(20);
    expect(worth(registry.get('laser'))).toBe(20);
  });
});

describe('scrap', () => {
  it('takes half the build time, fills the tank, and is no destruction', async () => {
    const { w, r } = await run({ grid: ['A  F  C  F  F'] }, { 1: "scrap('armorplate@0,0')" }, ticks(3));
    expect(answers(w)).toEqual([{ ok: true, seconds: 3, cost: 0 }]);
    expect(r.parts.has('armorplate@0,0')).toBe(false);
    expect(r.repair?.tank).toBeCloseTo(16, 10);
    expect(kinds(w, 'partScrapped')).toMatchObject([{ part: 'armorplate@0,0', partType: 'armorplate', gave: 16 }]);
    expect(kinds(w, 'partDestroyed')).toEqual([]);
    expect(kinds(w, 'explosion')).toEqual([]);
    w.dispose();
  });

  it('pays for the health it has at the end of the job', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [script({ 1: "scrap('frame@4,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 5; i++) w.step();
    (r.parts.get('frame@4,0') as PartInstance).health = 0.0001;
    for (let i = 0; i < ticks(SCRAP_FRAME); i++) w.step();
    expect(r.repair?.tank).toBeCloseTo(scrapGives(1, 0.0001 / registry.get('frame').health), 8);
    w.dispose();
  });

  it('an armed warhead scrapped makes no blast', async () => {
    const { w, r } = await run({ grid: ['H  F  C'], legend: { H: { part: 'heavywarhead', armed: true } } }, { 1: "scrap('heavywarhead@0,0')" }, ticks(jobSeconds(registry.get('heavywarhead')) * 0.5));
    expect(r.parts.has('heavywarhead@0,0')).toBe(false);
    expect(kinds(w, 'explosion')).toEqual([]);
    w.dispose();
  });

  it('nothing refuses a core: scrapped, it is lost like any other', async () => {
    const { w, r } = await run(LINE, { 1: "scrap('core@2,0')" }, ticks(jobSeconds(registry.get('core')) * 0.5));
    expect(answers(w)).toMatchObject([{ ok: true }]);
    expect(r.parts.has('core@2,0')).toBe(false);
    expect(kinds(w, 'coreLost')).toHaveLength(1);
    w.dispose();
  });

  it('cutting the robot in two is an ordinary split, and the tank stays with the active core', async () => {
    const { w, r } = await run({ grid: ['F  F  F  C  F'] }, { 1: "scrap('frame@1,0')" }, ticks(SCRAP_FRAME));
    expect(kinds(w, 'split')).toHaveLength(1);
    expect(r.primaryCoreId).toBe('core@3,0');
    expect(r.repair?.tank).toBeCloseTo(0.8, 10);
    expect(w.robots.filter((x) => x !== r).every((x) => x.repair === undefined)).toBe(true);
    w.dispose();
  });
});

describe('build', () => {
  it('puts a part back in blueprint order, at about 1 percent health, and it works', async () => {
    const seconds = SCRAP_FRAME;
    const first = 1 + Math.ceil(seconds * 60) + 2;
    const { w, r } = await run(LINE, { 1: "scrap('frame@1,0')", [first]: "build('frame@1,0')" }, first + ticks(BUILD_FRAME));
    expect(answers(w)).toMatchObject([{ ok: true }, { ok: true, cost: 0.5 }]);
    // frame@0,0 broke off with the scrap, so frame@1,0 goes back between nothing and the core.
    expect(live(r)).toEqual(order(r));
    expect(r.parts.has('frame@1,0')).toBe(true);
    expect((r.parts.get('frame@1,0') as PartInstance).health).toBeCloseTo(registry.get('frame').health * START_HEALTH, 10);
    expect(r.repair?.tank).toBeCloseTo(0.8 - 0.5, 10);
    expect(kinds(w, 'partRebuilt')).toMatchObject([{ part: 'frame@1,0', cost: 0.5 }]);
    expect(kinds(w, 'partDestroyed')).toEqual([]);
    w.dispose();
  });

  it('a part in the middle of the robot goes back in the middle of its order', async () => {
    const { w, r } = await run({ grid: ['F  C  F', '.  F  .'] }, { 1: "scrap('frame@0,1')", 80: "build('frame@0,1')" }, 140);
    expect(answers(w)).toMatchObject([{ ok: true }, { ok: true }]);
    expect(live(r)).toEqual(r.blueprint.parts.map((p) => p.id));
    expect(live(r)[1]).not.toBe(live(r)[0]);
    w.dispose();
  });

  it('a rebuilt container is empty: the tank pays for the part, not for what it holds', async () => {
    const { w, r } = await run({ grid: ['B  C  B', 'A  .  .'] }, { 1: "scrap('armorplate@0,0')", 240: "scrap('battery@2,1')", 300: "build('battery@2,1')" }, 300 + ticks(jobSeconds(registry.get('battery'))));
    expect(answers(w)).toMatchObject([{ ok: true }, { ok: true }, { ok: true }]);
    expect(r.parts.get('battery@2,1')?.stored).toBe(0);
    expect(r.parts.get('battery@0,1')?.stored).toBe(registry.get('battery').resource?.capacity);
    w.dispose();
  });

  it('refuses what it should, and says why', async () => {
    const orders = {
      1: "scrap('frame@4,0')",
      2: "scrap('frame@3,0')",
      40: "scrap('frame@3,0')",
      70: "build('core@2,0')",
      71: "build('nothing@9,9')",
      72: "scrap('nothing@9,9')",
      73: "heal('nothing@9,9')",
      74: "heal('frame@1,0')",
      75: "build('frame@4,0')",
    };
    const { w } = await run(LINE, orders, 80);
    expect(answers(w)).toEqual([
      { ok: true, seconds: SCRAP_FRAME, cost: 0 },
      { ok: false, why: 'busy' },
      { ok: true, seconds: SCRAP_FRAME, cost: 0 },
      { ok: false, why: 'not a lost part' },
      { ok: false, why: 'not a lost part' },
      { ok: false, why: 'not on this robot' },
      { ok: false, why: 'not on this robot' },
      { ok: false, why: 'full' },
      // frame@4,0 only touched frame@3,0, which is gone: no propellers in mid air.
      { ok: false, why: 'not touching' },
    ]);
    w.dispose();
  });

  it('refuses a part the tank cannot pay for, and a stopped build hands back what it took', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', grid: ['F  B  C'], scripts: [script({ 1: "scrap('frame@0,0')", 40: "build('battery@1,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 30; i++) w.step();
    (r.parts.get('battery@1,0') as PartInstance).health = 0;
    for (let i = 0; i < 15; i++) w.step();
    // 0.8 in the tank; a battery is worth 3, so creating it costs 1.5.
    expect(answers(w)).toMatchObject([{ ok: true }, { ok: false, why: 'tank short' }]);
    expect(r.repair?.tank).toBeCloseTo(0.8, 10);
    w.dispose();
    const stopped = await run({ grid: ['F  F  C'] }, { 1: "scrap('frame@0,0')", 40: "scrap('frame@1,0')", 70: "build('frame@1,0')", 71: 'tank()', 72: 'job()', 73: 'stopJob()', 74: 'tank()', 75: 'job()' }, 78);
    expect(answers(stopped.w).slice(2)).toMatchObject([{ ok: true, cost: 0.5 }, 1.1, { kind: 'build', part: 'frame@1,0' }, null, 1.6, null]);
    stopped.w.dispose();
  });

  it('refuses a cell something is in', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [script({ 1: "scrap('frame@4,0')", 60: "build('frame@4,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 40; i++) w.step();
    w.spawnBlueprint({ format: 1, name: 'lump', grid: ['F'] }, { x: partWorldPose(w, r, 'frame@3,0').x + 1, y: 0.6 });
    for (let i = 0; i < 25; i++) w.step();
    expect(answers(w)).toMatchObject([{ ok: true }, { ok: false, why: 'blocked' }]);
    w.dispose();
  });

  it('hands back what it took when the cell fills while it builds', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [script({ 1: "scrap('frame@4,0')", 60: "build('frame@4,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 62; i++) w.step();
    const held = r.repair?.tank ?? 0;
    w.spawnBlueprint({ format: 1, name: 'lump', grid: ['F'] }, { x: partWorldPose(w, r, 'frame@3,0').x + 1, y: 0.6 });
    for (let i = 0; i < ticks(BUILD_FRAME); i++) w.step();
    expect(r.parts.has('frame@4,0')).toBe(false);
    expect(r.repair?.tank).toBeCloseTo(held + 0.5, 10);
    expect(kinds(w, 'repairFailed')).toMatchObject([{ part: 'frame@4,0', why: 'blocked' }]);
    w.dispose();
  });
});

describe('heal', () => {
  it('a part at 40 percent healed to full costs 30 percent of its worth', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', grid: ['A  C  F'], scripts: [script({ 1: "scrap('armorplate@0,0')", 200: "heal('frame@2,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 190; i++) w.step();
    const frame = r.parts.get('frame@2,0') as PartInstance;
    frame.health = 0.4 * registry.get('frame').health;
    const tank = r.repair?.tank ?? 0;
    for (let i = 0; i < 20 + ticks(jobSeconds(registry.get('frame')) * 0.6); i++) w.step();
    expect(frame.health).toBeCloseTo(registry.get('frame').health, 8);
    expect(tank - (r.repair?.tank ?? 0)).toBeCloseTo(0.3 * worth(registry.get('frame')), 8);
    expect(kinds(w, 'partHealed')).toHaveLength(1);
    w.dispose();
  });

  it('from nothing to full takes the build time again, and stops where the tank runs out', async () => {
    const frame = registry.get('frame');
    const { w, r } = await run({ grid: ['F  C'] }, { 1: "scrap('frame@0,0')", 60: "build('frame@0,0')", 120: "heal('frame@0,0')", 121: 'job()' }, 200);
    const part = r.parts.get('frame@0,0') as PartInstance;
    // 0.8 scrapped, 0.5 built, 0.3 left of the 0.495 full health wants.
    expect(r.repair?.tank).toBeCloseTo(0, 10);
    expect(part.health / frame.health).toBeCloseTo(START_HEALTH + 0.3 / 0.5, 8);
    expect(answers(w)[3]).toMatchObject({ kind: 'heal', part: 'frame@0,0' });
    w.dispose();
  });

  it('stops at the share it is told to', async () => {
    const { r, w } = await run({ grid: ['A  C  F'] }, { 1: "scrap('armorplate@0,0')", 200: "heal('frame@2,0', 1)" }, 203);
    expect(answers(w)[1]).toEqual({ ok: false, why: 'full' });
    expect(r.repair?.jobs).toEqual([]);
    w.dispose();
  });
});

describe('readings', () => {
  it('lost() lists what is gone with its costs and whether it touches the robot', async () => {
    const brief = "(p) => ({ id: p.id, type: p.type, tags: p.tags, juice: p.juice, create: p.create, seconds: p.seconds, touching: p.touching })";
    const { w } = await run({ grid: ['.  L  F  C  F'], legend: { L: { part: 'laser', rot: 90, tags: ['gun'] } } }, { 1: "scrap('frame@2,0')", 60: `lost().map(${brief})`, 61: 'lost({ touching: true }).map((p) => p.id)', 62: "lost({ of: 'gun' }).map((p) => p.type)", 63: 'lost({ nope: 1 })' }, 66, { y: 5 });
    const [, all, touching, gun, bad] = answers(w) as unknown[][];
    expect(all).toMatchObject([
      { type: 'laser', tags: ['gun'], juice: 20, create: 10, seconds: 6, touching: false },
      { id: 'frame@2,0', juice: 1, create: 0.5, touching: true },
    ]);
    expect(touching).toEqual(['frame@2,0']);
    expect(gun).toEqual(['laser']);
    expect(bad).toBeNull();
    expect(w.scriptLogs.some((l) => l.text.includes("the options are 'of' and 'touching'"))).toBe(true);
    w.dispose();
  });

  it('own() reads the robot itself, with scan options', async () => {
    const brief = '(p) => ({ id: p.id, health: p.health, maxHealth: p.maxHealth, juice: p.juice, gives: p.gives, heal: p.heal, seconds: p.seconds })';
    const { w } = await run({ grid: ['A  F  C'], legend: { A: { part: 'armorplate', tags: ['plate'] } } }, { 1: 'own().length', 2: `own({ of: 'plate' }).map(${brief})` }, 4);
    expect(answers(w)).toEqual([3, [{ id: 'armorplate@0,0', health: 250, maxHealth: 250, juice: 20, gives: 16, heal: 0, seconds: 6 }]]);
    w.dispose();
  });

  it('tank() and job() read 0 and null before anything is ordered, and a robot stays out of the hash until then', async () => {
    const { w, r } = await run(LINE, { 1: 'tank()', 2: 'job()', 3: 'lost()', 4: 'stopJob()' }, 6);
    expect(answers(w)).toEqual([0, null, [], null]);
    expect(r.repair).toBeUndefined();
    w.dispose();
  });

  it('a script may name its own tank, job, build, and heal', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [{ id: 'mine', source: `const tank = 3; let job = 2; function build() { return tank + job; } function tick() { log(String(build())); }` }] }, { x: 0, y: 0.6 });
    w.step();
    expect(w.scriptLogs.map((l) => l.text)).toEqual(['5']);
    expect(w.scripts(r.id)[0]?.crashed).toBeUndefined();
    w.dispose();
  });

  it('at most 16 orders a tick', async () => {
    const { w } = await run(LINE, { 1: "Array.from({ length: 18 }, () => heal('frame@0,0').why).slice(14)" }, 2);
    expect(answers(w)).toEqual([['full', 'full', 'too many orders this tick', 'too many orders this tick']]);
    w.dispose();
  });
});

describe('parts on joints', () => {
  const TURN = [{ key: 'z', mode: 'hold', target: 'rotator', channel: 'turn', value: 1 }];
  /** A bar on a rotator on a core, a plate to pay with. */
  const TURRET = { format: 1, name: 'turret', autoControls: false, bindings: TURN, grid: ['.  .  F  .  .', '.  .  F  .  .', '.  .  R  .  .', 'A  B  C  B  B'] };
  const hold = (w: World, r: Robot, ticks: number): void => {
    w.step([{ robot: r.id, pressed: ['z'], released: [] }]);
    for (let i = 1; i < ticks; i++) w.step();
    w.step([{ robot: r.id, pressed: [], released: ['z'] }]);
  };
  const rests = (w: World, r: Robot, on: string, id: string): void => {
    const hinge = partWorldPose(w, r, on);
    const pose = partWorldPose(w, r, id);
    expect(Math.abs(hinge.angle)).toBeGreaterThan(0.2);
    // One cell along the turret's own up, not the robot's.
    expect(pose.x).toBeCloseTo(hinge.x - sin(hinge.angle), 3);
    expect(pose.y).toBeCloseTo(hinge.y + cos(hinge.angle), 3);
    expect(pose.angle).toBeCloseTo(hinge.angle, 3);
  };

  it('a part on a turned rotator comes back on its turret, where the turret is now', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ ...TURRET, scripts: [script({ 50: "scrap('frame@2,3')", 100: "build('frame@2,3')" })] }, { x: 0, y: 0.6 });
    hold(w, r, 30);
    for (let i = 0; i < 100 + ticks(BUILD_FRAME); i++) w.step();
    expect(kinds(w, 'partRebuilt')).toHaveLength(1);
    const turret = r.groups.find((g) => g.joint?.partId === 'rotator@2,1');
    expect(turret?.partIds).toContain('frame@2,3');
    expect((r.parts.get('frame@2,3') as PartInstance).group).toBe(turret?.index);
    rests(w, r, 'frame@2,2', 'frame@2,3');
    expect(live(r)).toEqual(r.blueprint.parts.map((p) => p.id));
    w.dispose();
  });

  it('a rotator rebuilt with something lost beyond it: the part beyond goes on it, turned as it is by then', async () => {
    const orders: Record<number, string> = {};
    let at = 1;
    const add = (code: string, seconds: number): void => {
      orders[at] = code;
      at += Math.ceil(seconds * 60) + 3;
    };
    const rotator = jobSeconds(registry.get('rotator'));
    add("scrap('armorplate@0,0')", 3);
    add("scrap('frame@2,3')", SCRAP_FRAME);
    add("scrap('frame@2,2')", SCRAP_FRAME);
    add("scrap('rotator@2,1')", rotator / 2);
    add("build('rotator@2,1')", rotator);
    const turn = at;
    at += 40;
    add("build('frame@2,2')", BUILD_FRAME);
    add("build('frame@2,3')", BUILD_FRAME);
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ ...TURRET, scripts: [script(orders)] }, { x: 0, y: 0.6 });
    for (let i = 0; i < turn; i++) w.step();
    expect(r.parts.has('rotator@2,1')).toBe(true);
    hold(w, r, 30);
    for (let i = 0; i < at - turn - 30; i++) w.step();
    expect(kinds(w, 'partRebuilt')).toMatchObject([{ part: 'rotator@2,1' }, { part: 'frame@2,2' }, { part: 'frame@2,3' }]);
    rests(w, r, 'rotator@2,1', 'frame@2,2');
    rests(w, r, 'frame@2,2', 'frame@2,3');
    // The rebuilt rotator still answers its key: it is a joint again, not a frame.
    const aim = r.parts.get('rotator@2,1')?.aim ?? 0;
    hold(w, r, 10);
    expect(r.parts.get('rotator@2,1')?.aim).toBeGreaterThan(aim);
    w.dispose();
  });

  it('a part on an extended piston comes back on the piston head', async () => {
    const bindings = [{ key: 'j', mode: 'hold', target: 'piston', channel: 'extend', value: 1 }];
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'push', grid: ['B  B  B  C  I>  F  F'], bindings, scripts: [script({ 120: "scrap('frame@6,0')", 170: "build('frame@6,0')" })] }, { x: 0, y: 3 });
    w.step([{ robot: r.id, pressed: ['j'], released: [] }]);
    for (let i = 0; i < 170 + ticks(BUILD_FRAME); i++) w.step();
    expect(kinds(w, 'partRebuilt')).toHaveLength(1);
    const head = partWorldPose(w, r, 'frame@5,0');
    const back = partWorldPose(w, r, 'frame@6,0');
    expect(back.x - head.x).toBeCloseTo(cos(head.angle), 3);
    expect(back.y - head.y).toBeCloseTo(sin(head.angle), 3);
    expect(head.x - partWorldPose(w, r, 'core@3,0').x).toBeGreaterThan(2.5);
    w.dispose();
  });

  it('the base under a rotator comes back as its parent, in the frame of the robot that is left', async () => {
    const orders = { 1: "scrap('frame@1,0')", 40: "build('frame@1,0')" };
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'up', primaryCore: 'core@1,2', grid: ['F  C  F', '.  R  .', 'F  F  F'], scripts: [script(orders)] }, { x: 0, y: 200 });
    for (let i = 0; i < 40 + ticks(BUILD_FRAME); i++) w.step();
    expect(kinds(w, 'split')).toHaveLength(1);
    expect(kinds(w, 'partRebuilt')).toHaveLength(1);
    const hinge = r.groups.find((g) => g.joint?.partId === 'rotator@1,1');
    expect(hinge).toBeDefined();
    expect(r.groups[hinge?.joint?.parentGroup ?? -1]?.partIds).toEqual(['frame@1,0']);
    const base = partWorldPose(w, r, 'frame@1,0');
    const rotator = partWorldPose(w, r, 'rotator@1,1');
    expect(Math.hypot(base.x - rotator.x, base.y - rotator.y)).toBeCloseTo(1, 2);
    w.dispose();
  });
});

describe('what must stay as it was', () => {
  const CYCLE = { 1: "scrap('frame@1,0')", 40: "build('frame@1,0')", 90: "heal('frame@1,0')", 200: "scrap('frame@3,0')", 240: "build('frame@3,0')" };
  it('a rebuild from what the robot kept and one from scratch give the same world', async () => {
    const a = await World.create({ seed: 1, scripts: host }, open);
    const b = await World.create({ seed: 1, scripts: host, fullRebuild: true }, open);
    const bp = { format: 1, name: 'bot', grid: ['.  .  P  .  .', 'F  F  C  F  F'], scripts: [script(CYCLE)] };
    a.spawnBlueprint(bp, { x: 0, y: 1.6 });
    b.spawnBlueprint(bp, { x: 0, y: 1.6 });
    for (let i = 0; i < 320; i++) {
      a.step();
      b.step();
      expect(a.hash()).toBe(b.hash());
    }
    expect(kinds(a, 'partRebuilt')).toHaveLength(2);
    expect(a.rebuilds.assembled).toBeGreaterThan(0);
    a.dispose();
    b.dispose();
  });

  it('scripts see the same parts whether a change comes as a patch or a whole layout', async () => {
    const seen = `function tick() { if (frame % 7 === 0) log(parts.map((p) => p.id + p.type + p.pos.x.toFixed(6)).join(' ')); }`;
    const orders = script(CYCLE);
    const go = async (fullLayouts: boolean): Promise<string[]> => {
      const w = await World.create({ seed: 1, scripts: host, ...(fullLayouts ? { fullLayouts: true } : {}) }, open);
      w.spawnBlueprint({ format: 1, name: 'bot', grid: ['F  F  C  F  F'], scripts: [orders, { id: 'seen', source: seen }] }, { x: 0, y: 0.6 });
      for (let i = 0; i < 320; i++) w.step();
      const lines = w.scriptLogs.filter((l) => l.script === 'seen').map((l) => l.text);
      w.dispose();
      return lines;
    };
    const patched = await go(false);
    expect(patched).toEqual(await go(true));
    expect(new Set(patched.map((l) => l.split(' ').length)).size).toBeGreaterThan(1);
  });

  it('runs the same from its replay', async () => {
    const w = await World.create({ seed: 7, scripts: host }, open);
    w.spawnBlueprint({ format: 1, name: 'bot', grid: ['F  F  C  F  F'], scripts: [script(CYCLE)] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 320; i++) w.step();
    const out = await runReplay(buildReplay(w), undefined, host);
    expect(out.matches).toBe(true);
    expect(out.hash).toBe(w.hash());
    out.world.dispose();
    w.dispose();
  });

  it('a robot that never orders anything hashes as it would with no repair at all', async () => {
    const quiet = await run(LINE, {}, 30);
    const reading = await run(LINE, { 1: 'tank()', 2: 'lost()', 3: 'own()', 4: 'job()' }, 30);
    expect(reading.w.hash()).toBe(quiet.w.hash());
    quiet.w.dispose();
    reading.w.dispose();
  });
});

describe('around the edges', () => {
  it('a job on a part shot away ends with it', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [script({ 1: "scrap('frame@4,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 4; i++) w.step();
    (r.parts.get('frame@4,0') as PartInstance).health = 0;
    w.step();
    w.step();
    expect(r.repair?.jobs).toEqual([]);
    expect(r.repair?.tank).toBe(0);
    expect(kinds(w, 'partDestroyed')).toMatchObject([{ part: 'frame@4,0' }]);
    w.dispose();
  });

  it('a wreck runs no jobs', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint({ format: 1, name: 'bot', ...LINE, scripts: [script({ 1: "scrap('frame@4,0')" })] }, { x: 0, y: 0.6 });
    for (let i = 0; i < 4; i++) w.step();
    (r.parts.get('core@2,0') as PartInstance).health = 0;
    for (let i = 0; i < 40; i++) w.step();
    expect(kinds(w, 'partScrapped')).toEqual([]);
    expect(w.robots.every((x) => x.repair === undefined)).toBe(true);
    w.dispose();
  });

  it('a grapple scrapped loses its rope, and a rope on a scrapped part goes too', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const bindings = [{ key: 'f', mode: 'hold', target: 'grapple', channel: 'fire', value: 1 }];
    const r = w.spawnBlueprint({ format: 1, name: 'hook', grid: ['C Gp>'], bindings, scripts: [script({ 10: "scrap('grapple@1,0')" })] }, { x: -100, y: 0.5 });
    w.spawnBlueprint({ format: 1, name: 'target', grid: ['F F'] }, { x: -80, y: 0.5 });
    w.step([{ robot: r.id, pressed: ['f'], released: [] }]);
    expect(w.liveRopes()).toHaveLength(1);
    for (let i = 0; i < 10 + ticks(jobSeconds(registry.get('grapple')) * 0.5); i++) w.step();
    expect(r.parts.has('grapple@1,0')).toBe(false);
    expect(w.liveRopes()).toHaveLength(0);
    expect(kinds(w, 'unhooked')).toMatchObject([{ why: 'lost' }]);
    w.dispose();
  });

  it('a woken piece makes only what was its own, not the robot it left', async () => {
    const listing = `function tick() { if (frame === 5) log(JSON.stringify(lost().map((p) => p.id))); }`;
    const bp = {
      format: 1,
      name: 'launcher',
      primaryCore: 'core@0,0',
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'frame', x: 1, y: 0 },
        { part: 'core', x: 2, y: 0, tags: ['missile1'] },
        { part: 'frame', x: 3, y: 0, tags: ['missile1'] },
        { part: 'frame', x: 4, y: 0, tags: ['missile1'] },
      ],
      cores: { 'core@2,0': { scope: 'missile1', scripts: [{ id: 'm', source: listing }] } },
    };
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint(bp, { x: 0, y: 0.6 });
    w.step();
    (r.parts.get('frame@1,0') as PartInstance).health = 0;
    (r.parts.get('frame@4,0') as PartInstance).health = 0;
    for (let i = 0; i < 12; i++) w.step();
    expect(kinds(w, 'coreWoke')).toHaveLength(1);
    expect(answers(w)).toEqual([['frame@4,0']]);
    w.dispose();
  });

  const bay = (): Record<string, unknown> => ({
    format: 1,
    name: 'bay-bot',
    parts: [
      { part: 'core', x: 0, y: 0 },
      { part: 'densebattery', x: -1, y: 0 },
      { part: 'densebattery', x: 1, y: 0 },
      { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
    ],
    recipes: { item: resolveScripts(JSON.parse(bpFile('missile-up.json')), bpFile).raw },
  });

  it('a copy a bay holds cannot be scrapped, and one it let go is not a lost part', async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const bp = { ...bay(), scripts: [{ id: 'pilot', source: `function tick() {
      const held = parts.find((p) => p.tags[0] === 'bay1');
      if (held && !state.tried) { state.tried = true; log(JSON.stringify(scrap(held.id))); state.at = frame; }
      if (state.at && frame === state.at + 5) set('bay', 'release', 1);
      if (state.at && frame === state.at + 120) log(JSON.stringify(lost()));
    }` }] };
    const r = w.spawnBlueprint(bp, { x: 0, y: 0.6 });
    for (let i = 0; i < 1200 && answers(w).length < 2; i++) w.step();
    expect(answers(w)).toEqual([{ ok: false, why: 'held in a bay' }, []]);
    expect(r.firstCopy).toBe(4);
    w.dispose();
  });
});
