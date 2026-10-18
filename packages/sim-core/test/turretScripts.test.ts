import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readdirSync, readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

/**
 * The turret scripts' shared lookup of the parts their turrets aim at on a huge robot (`aimedParts`, review
 * 2026-10-18): one `scan(id, { of: ids })` names at most 64 parts, and past that it returned null, so a robot with
 * more than 64 turrets on one titan lost every turret's pick every tick.
 */
const dir = new URL('../../../blueprints/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const fn = (text: string): string | undefined => /\nfunction aimedParts\(id\) \{\n[\s\S]*?\n\}\n/.exec(text)?.[0];
const copies = files.flatMap((f) => {
  const body = fn(readFileSync(new URL(f, dir), 'utf8'));
  return body ? [{ file: f, body }] : [];
});

let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 100 }, boxes: [] });

/** `aimedParts` from the turret scripts, with `turrets` turrets each on its own part of the robot in view. */
async function aimed(turrets: number): Promise<string[]> {
  const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
  const source = `${copies[0]?.body}
function tick() {
  var c = contacts[0];
  if (!c || state.done) return;
  if (!state.ids) {
    state.ids = scan(c.id).slice(0, ${turrets}).map(function (p) { return p.id; });
    return;
  }
  state.turrets = {};
  for (var i = 0; i < state.ids.length; i++) state.turrets['t' + i] = { id: c.id, part: state.ids[i] };
  var list = aimedParts(c.id);
  log(list === null ? 'null' : list.length + ' of ' + state.ids.length + ', ' + (list.every(function (p) { return state.ids.indexOf(p.id) >= 0; }) ? 'all asked for' : 'others too'));
  state.done = true;
}`;
  const me = w.spawnBlueprint({ format: 1, name: 'radar-bot', grid: ['C  O  B'], scripts: [{ id: 't', source }] }, { x: 0, y: 100 });
  const rows = Array.from({ length: 25 }, (_, y) => Array.from({ length: 30 }, (_, x) => (x === 15 && y === 12 ? 'C' : 'F')).join('  '));
  w.spawnBlueprint({ format: 1, name: 'slab', grid: rows }, { x: 60, y: 100 }, { team: 1 });
  for (let i = 0; i < 4; i++) w.step();
  const logs = w.scriptLogs.filter((l) => l.robot === me.id).map((l) => l.text);
  w.dispose();
  return logs;
}

describe('turret scripts: the parts their turrets aim at on a huge robot', () => {
  it('every copy of aimedParts is the same', () => {
    expect(copies.length).toBeGreaterThan(15);
    for (const c of copies) expect(c.body, c.file).toBe(copies[0]?.body);
  });

  it('64 turrets or fewer ask in one scan, as before; more ask 64 at a time', async () => {
    expect((await aimed(40))[0]).toBe('40 of 40, all asked for');
    expect((await aimed(64))[0]).toBe('64 of 64, all asked for');
    expect((await aimed(150))[0]).toBe('150 of 150, all asked for');
    // Past the 4 scans a tick: what the scans gave, and no option refused.
    expect(await aimed(300)).toEqual(['scan(): at most 4 calls per tick; this one returned null', '256 of 300, all asked for']);
  });
});
