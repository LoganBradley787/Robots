import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import { COVER_TESTS_MAX, COVER_TOO_MUCH, coverAlong, readScanOptions, selectScanned, WIDE_MAX, type ScanPartInfo } from '../src/script/scanOptions';
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
/** `selectScanned` where it answers with parts. */
function picked(...args: Parameters<typeof selectScanned>): ScannedPart[] {
  const out = selectScanned(...args);
  if (typeof out === 'string') throw new Error(out);
  return out;
}
/** `coverAlong` with no ceiling, which always answers. */
function cover(parts: readonly ScannedPart[], sel: readonly number[], from: { x: number; y: number }): { health: number[]; count: number[] } {
  const out = coverAlong(parts, sel, from, 0.5);
  if (typeof out === 'string') throw new Error(out);
  return out;
}

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
    // A line wider than a few meters is no aim, and would test most of a robot against each part (review 2026-10-18).
    expect(readScanOptions({ from: { x: 0, y: 0 }, wide: WIDE_MAX })).toEqual({ from: { x: 0, y: 0 }, wide: WIDE_MAX });
    expect(readScanOptions({ from: { x: 0, y: 0 }, wide: WIDE_MAX + 0.01 })).toMatch(/wide must be a number of meters above 0 and at most 3/);
    expect(readScanOptions({ from: { x: 0, y: 0 }, wide: 1e6 })).toMatch(/at most 3/);
    expect(readScanOptions([1])).toMatch(/must be an object/);
    expect(readScanOptions({ acts: true })).toEqual({ acts: true });
    expect(readScanOptions({ acts: false })).toEqual({});
    expect(readScanOptions({ acts: 1 })).toMatch(/acts must be true or false/);
  });
});

describe('scan options, pick (M16)', () => {
  const list = [part('a', 'core', 0, 0), part('b', 'frame', 3, 0), part('c', 'thruster', 1, 0), part('d', 'frame', 1, 0), part('e', 'battery', -5, 0)];
  const info = (i: number): ScanPartInfo => (i === 2 ? { tags: ['lift'], def: { inputs: [{ name: 'throttle' }], outputs: [] } } : i === 4 ? { tags: [], def: { inputs: [], outputs: [{ name: 'stored' }] } } : NONE);

  it('of matches an id, a type, or a tag; has an input or output; both must hold; blueprint order kept', () => {
    const ids = (o: Parameters<typeof selectScanned>[2]): string[] => picked(list, info, o).map((p) => p.id);
    expect(ids({ of: ['frame'] })).toEqual(['b', 'd']);
    expect(ids({ of: ['e', 'lift'] })).toEqual(['c', 'e']);
    expect(ids({ has: ['throttle', 'stored'] })).toEqual(['c', 'e']);
    expect(ids({ of: ['lift', 'frame'], has: ['throttle'] })).toEqual(['c']);
  });

  it('most keeps the nearest (ties in blueprint order), returned in blueprint order', () => {
    const ids = (most: number): string[] => picked(list, info, { near: { x: 1, y: 0 }, most }).map((p) => p.id);
    // c and d are both at the point: c comes first in the blueprint.
    expect(ids(1)).toEqual(['c']);
    expect(ids(2)).toEqual(['c', 'd']);
    expect(ids(3)).toEqual(['a', 'c', 'd']);
    expect(ids(0)).toEqual([]);
    // Fewer parts than the limit: the very list a plain scan gives.
    const all = picked(list, info, { near: { x: 1, y: 0 }, most: 5 });
    expect(all).toEqual(list);
    expect(all[0]).toBe(list[0]);
  });

  it('cover sums the health of parts in front within the width, over every part, even those not returned', () => {
    const row = [part('far', 'thruster', 10, 0, 25), part('mid', 'frame', 8, 0.4, 60), part('near', 'battery', 6, 0, 30), part('off', 'frame', 8, 0.6, 60), part('side', 'frame', 9.8, 0, 60)];
    const out = picked(row, () => NONE, { of: ['far', 'near'], from: { x: 0, y: 0 } });
    expect(out.map((p) => [p.id, p.cover, p.coverParts])).toEqual([
      ['far', 90, 2],
      ['near', 0, 0],
    ]);
    // Wider takes the frame 0.6 off the line too; the copy is new, the scan's own list untouched.
    expect(picked(row, () => NONE, { of: ['far'], from: { x: 0, y: 0 }, wide: 0.7 })[0]?.cover).toBe(150);
    expect(row[0]?.cover).toBeUndefined();
  });

  it('acts adds the way each part that acts along a face pushes or fires, in the world', () => {
    const tilted = [part('up', 'thruster', 0, 0), part('left', 'thruster', 1, 0), part('frame', 'frame', 2, 0)];
    (tilted[1] as ScannedPart).angle = 0.25;
    const about = (i: number): ScanPartInfo => (i === 0 ? { tags: [], rot: 0, def: { inputs: [], outputs: [], acts: 'N' } } : i === 1 ? { tags: [], rot: 90, def: { inputs: [], outputs: [], acts: 'N' } } : { tags: [], rot: 0, def: { inputs: [], outputs: [] } });
    const out = picked(tilted, about, { acts: true });
    expect(out.map((p) => p.acts)).toEqual([Math.PI / 2, 0.25 + Math.PI / 2 + Math.PI / 2, undefined]);
    // Copies: the scan's own list is untouched, and a part without a way is the very object.
    expect(tilted[0]?.acts).toBeUndefined();
    expect(out[2]).toBe(tilted[2]);
    // With from, the copy carries both.
    const both = picked(tilted, about, { of: ['left'], from: { x: -10, y: 0 }, acts: true })[0];
    expect([both?.acts, both?.cover]).toEqual([0.25 + Math.PI, 10]);
  });

  it('cover that would test too many pairs of parts is refused before any is tested', () => {
    // 900 parts in a square, looked at from its middle along a line 1 m wide: every part is that near, so each is tried
    // against half the others (with 0.5 m, a quarter: 202,500 pairs, under the ceiling).
    const square: ScannedPart[] = [];
    for (let i = 0; i < 900; i++) square.push(part(`p${i}`, 'frame', (i % 30) - 14.5, Math.floor(i / 30) - 14.5));
    const all = square.map((_, i) => i);
    const mid = { x: 0, y: 0 };
    expect(coverAlong(square, all, mid, 1, COVER_TESTS_MAX)).toBe(COVER_TOO_MUCH);
    expect(selectScanned(square, () => NONE, { from: mid, wide: 1 })).toBe(COVER_TOO_MUCH);
    expect(typeof selectScanned(square, () => NONE, { from: mid })).toBe('object');
    // Fewer asked about is fine, and the answer is what it is with no ceiling.
    const some = selectScanned(square, () => NONE, { from: mid, wide: 1, near: mid, most: 100 });
    expect(Array.isArray(some) && some.length).toBe(100);
    const near = all.filter((i) => Math.abs((square[i] as ScannedPart).pos.x) < 5 && Math.abs((square[i] as ScannedPart).pos.y) < 5);
    expect(coverAlong(square, near, mid, 1, COVER_TESTS_MAX)).toEqual(coverAlong(square, near, mid, 1));
    // Far off, the line's angle is narrow and every part may be asked about.
    expect(typeof selectScanned(square, () => NONE, { from: { x: 0, y: 100 }, wide: 1 })).toBe('object');
  });

  it('cover is the same whether found by sorting angles or by trying every part', () => {
    const rng = new Prng(7);
    const parts: ScannedPart[] = [];
    for (let i = 0; i < 400; i++) parts.push(part(`p${i}`, 'frame', 20 + Math.floor(rng.next() * 30), Math.floor(rng.next() * 30) - 15, 1 + Math.floor(rng.next() * 100) / 7));
    for (const from of [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: -60, y: -1 }]) {
      const all = parts.map((_, i) => i);
      const many = cover(parts, all, from);
      // One at a time never sorts.
      for (const i of [0, 17, 123, 399]) {
        const one = cover(parts, [i], from);
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

  it('acts says which way a seen robot\'s parts push, from how they were built turned', async () => {
    const logs = await look(`
      function tick() {
        if (frame !== 2) return;
        var c = contacts[0];
        var ps = scan(c.id, { has: 'throttle', acts: true });
        log(ps.map(function (p) { return p.type + ':' + Math.round((p.acts * 180) / Math.PI); }).join(' '));
        log(scan(c.id, { of: 'core', acts: true })[0].acts === undefined);
      }`);
    expect(logs).toEqual(['thruster:90', 'true']);
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

  it('cover that is too much work returns null and is logged once; asking about fewer parts works', async () => {
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const me = w.spawnBlueprint(
      {
        ...RADAR,
        scripts: [
          {
            id: 'look',
            source: `
      function tick() {
        var c = contacts[0];
        if (!c || frame < 2 || frame > 4) return;
        log(scan(c.id, { from: c.pos, wide: 1 }), scan(c.id, { from: c.pos, wide: 1, near: c.pos, most: 50 }).length);
      }`,
          },
        ],
      },
      { x: 0, y: 100 },
    );
    // 30 by 25 frames and a core: looked at from its own core along a line 1 m wide, each part is tried against half the rest.
    const rows = Array.from({ length: 25 }, (_, y) => Array.from({ length: 30 }, (_, x) => (x === 15 && y === 12 ? 'C' : 'F')).join('  '));
    w.spawnBlueprint({ format: 1, name: 'slab', grid: rows }, { x: 60, y: 100 }, { team: 1 });
    for (let i = 0; i < 6; i++) w.step();
    expect(w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text)).toEqual([COVER_TOO_MUCH, 'null 50', 'null 50', 'null 50']);
    w.dispose();
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
