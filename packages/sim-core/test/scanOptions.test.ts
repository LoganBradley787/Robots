import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import { coverAlong, readScanOptions, selectScanned, type ScanPartInfo } from '../src/script/scanOptions';
import type { ScannedPart, ScriptHost } from '../src/script/types';
import { Prng } from '../src/rng/Prng';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });
const RADAR = { format: 1, name: 'radar-bot', grid: ['C  O  B'] };
/** A row of five, battery first; the thruster at the far end is tagged `lift`. */
const ROW = { format: 1, name: 'row', grid: ['B  F  F  C  L'], legend: { L: { part: 'thruster', rot: 0, tags: ['lift'] } } };

function part(id: string, type: string, x: number, y: number, health = 10): ScannedPart {
  return { id, type, pos: { x, y }, angle: 0, health, maxHealth: health };
}
const NONE: ScanPartInfo = { tags: [], def: { inputs: [], outputs: [] } };

describe('scan options, read (M16)', () => {
  it('reads what is asked and refuses what would quietly hand back every part', () => {
    expect(readScanOptions(undefined)).toEqual({});
    expect(readScanOptions({ near: { x: 1, y: 2 }, most: 3.7, of: 'core', has: ['throttle'], from: { x: 0, y: 0 }, wide: 1 })).toEqual({
      near: { x: 1, y: 2 },
      most: 3,
      of: ['core'],
      has: ['throttle'],
      from: { x: 0, y: 0 },
      wide: 1,
    });
    expect(readScanOptions({ nearest: { x: 0, y: 0 } })).toMatch(/no option 'nearest'/);
    expect(readScanOptions({ most: 5 })).toMatch(/most needs near/);
    expect(readScanOptions({ most: '5', near: { x: 0, y: 0 } })).toMatch(/most must be a number/);
    expect(readScanOptions({ near: { x: 0 } })).toMatch(/near must be a point/);
    expect(readScanOptions({ of: [1] })).toMatch(/of must be a name/);
    expect(readScanOptions({ from: { x: 0, y: 0 }, wide: 0 })).toMatch(/wide must be/);
    expect(readScanOptions([1])).toMatch(/must be an object/);
  });
});

describe('scan options, pick (M16)', () => {
  const list = [part('a', 'core', 0, 0), part('b', 'frame', 3, 0), part('c', 'thruster', 1, 0), part('d', 'frame', 1, 0), part('e', 'battery', -5, 0)];
  const info = (i: number): ScanPartInfo => (i === 2 ? { tags: ['lift'], def: { inputs: [{ name: 'throttle' }], outputs: [] } } : i === 4 ? { tags: [], def: { inputs: [], outputs: [{ name: 'stored' }] } } : NONE);

  it('of matches an id, a type, or a tag; has an input or output; both must hold; blueprint order kept', () => {
    const ids = (o: Parameters<typeof selectScanned>[2]): string[] => selectScanned(list, info, o).map((p) => p.id);
    expect(ids({ of: ['frame'] })).toEqual(['b', 'd']);
    expect(ids({ of: ['e', 'lift'] })).toEqual(['c', 'e']);
    expect(ids({ has: ['throttle', 'stored'] })).toEqual(['c', 'e']);
    expect(ids({ of: ['lift', 'frame'], has: ['throttle'] })).toEqual(['c']);
  });

  it('most keeps the nearest (ties in blueprint order), returned in blueprint order', () => {
    const ids = (most: number): string[] => selectScanned(list, info, { near: { x: 1, y: 0 }, most }).map((p) => p.id);
    // c and d are both at the point: c comes first in the blueprint.
    expect(ids(1)).toEqual(['c']);
    expect(ids(2)).toEqual(['c', 'd']);
    expect(ids(3)).toEqual(['a', 'c', 'd']);
    expect(ids(0)).toEqual([]);
    // Fewer parts than the limit: the very list a plain scan gives.
    const all = selectScanned(list, info, { near: { x: 1, y: 0 }, most: 5 });
    expect(all).toEqual(list);
    expect(all[0]).toBe(list[0]);
  });

  it('cover sums the health of parts in front within the width, over every part, even those not returned', () => {
    const row = [part('far', 'thruster', 10, 0, 25), part('mid', 'frame', 8, 0.4, 60), part('near', 'battery', 6, 0, 30), part('off', 'frame', 8, 0.6, 60), part('side', 'frame', 9.8, 0, 60)];
    const out = selectScanned(row, () => NONE, { of: ['far', 'near'], from: { x: 0, y: 0 } });
    expect(out.map((p) => [p.id, p.cover, p.coverParts])).toEqual([
      ['far', 90, 2],
      ['near', 0, 0],
    ]);
    // Wider takes the frame 0.6 off the line too; the copy is new, the scan's own list untouched.
    expect(selectScanned(row, () => NONE, { of: ['far'], from: { x: 0, y: 0 }, wide: 0.7 })[0]?.cover).toBe(150);
    expect(row[0]?.cover).toBeUndefined();
  });

  it('cover is the same whether found by sorting angles or by trying every part', () => {
    const rng = new Prng(7);
    const parts: ScannedPart[] = [];
    for (let i = 0; i < 400; i++) parts.push(part(`p${i}`, 'frame', 20 + Math.floor(rng.next() * 30), Math.floor(rng.next() * 30) - 15, 1 + Math.floor(rng.next() * 100) / 7));
    for (const from of [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: -60, y: -1 }]) {
      const all = parts.map((_, i) => i);
      const many = coverAlong(parts, all, from, 0.5);
      // One at a time never sorts.
      for (const i of [0, 17, 123, 399]) {
        const one = coverAlong(parts, [i], from, 0.5);
        expect([one.health[0], one.count[0]]).toEqual([many.health[i], many.count[i]]);
      }
      expect(many.count.some((c) => c > 0)).toBe(true);
    }
  });
});

describe('scan(id, opts) in a script (M16)', () => {
  async function look(src: string, frames = 4): Promise<string[]> {
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const me = w.spawnBlueprint({ ...RADAR, scripts: [{ id: 'look', source: src }] }, { x: 0, y: 100 });
    w.spawnBlueprint(ROW, { x: 30, y: 100 }, { team: 1 });
    for (let i = 0; i < frames; i++) w.step();
    const logs = w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text);
    for (const e of w.events) if (e.kind === 'scriptCrashed') logs.push(JSON.stringify(e.error));
    w.dispose();
    return logs;
  }

  it('plain scan(id) is unchanged, and an empty options object is the same', async () => {
    const logs = await look(`
      function tick() {
        if (frame !== 2) return;
        var c = contacts[0];
        var all = scan(c.id);
        log(JSON.stringify(all) === JSON.stringify(scan(c.id, {})), JSON.stringify(scan(c.id, null)) === JSON.stringify(all));
        log(all.map(function (p) { return p.type; }).join(' '));
      }`);
    expect(logs).toEqual(['true true', 'battery frame frame core thruster']);
  });

  it('of, has, near and most pick on the host; from adds cover', async () => {
    const logs = await look(`
      function tick() {
        if (frame !== 2) return;
        var c = contacts[0];
        var two = scan(c.id, { of: ['lift', 'core'] });
        log(two.map(function (p) { return p.id; }).join(' '));
        // The battery, three cells left of the core.
        var b = { x: two[0].pos.x - 3, y: two[0].pos.y };
        log(scan(c.id, { has: 'throttle', near: self.pos, most: 1 }).map(function (p) { return p.type; }).join(' '));
        log(scan(c.id, { near: { x: b.x + 2, y: b.y }, most: 2 }).map(function (p) { return p.type; }).join(' '));
        var cov = scan(c.id, { from: { x: b.x - 10, y: b.y } });
        log(cov.map(function (p) { return p.type + ':' + p.cover + '/' + p.coverParts; }).join(' '));
      }`);
    expect(logs).toEqual(['core@3,0 thruster@4,0', 'thruster', 'frame frame', 'battery:0/0 frame:30/1 frame:90/2 core:150/3 thruster:200/4']);
  });

  it('options count toward the 4 scans a tick; a bad option returns null and is logged once', async () => {
    const logs = await look(
      `
      function tick() {
        if (frame < 2) return;
        var c = contacts[0];
        log(scan(c.id, { most: 3 }), scan(c.id, { of: 'core' }).length, scan(c.id, { of: 'core' }).length, scan(c.id, { of: 'core' }).length, scan(c.id, { of: 'core' }));
      }`,
      4,
    );
    expect(logs).toEqual([
      'scan(): most needs near, the point the nearest parts are counted from (or from)',
      'scan(): at most 4 calls per tick; this one returned null',
      'null 1 1 1 null',
      'null 1 1 1 null',
    ]);
  });

  it('is the same every run', async () => {
    const src = `
      function tick() {
        var c = contacts[0];
        if (!c) return;
        var p = scan(c.id, { near: self.pos, most: 3, from: self.pos, wide: 0.8 });
        log(JSON.stringify(p));
      }`;
    const a = await look(src, 20);
    expect(a.length).toBeGreaterThan(5);
    expect(await look(src, 20)).toEqual(a);
  });
});
