import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { resolveScripts } from '../src/blueprint/scripts';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { bpFile } from './shelfHelp';

/**
 * `part.center` (M16 review): where a part's middle is, from its position, built unturned, at the size it was placed.
 * Scripts took every part's weight to be at its first cell, so a robot with cannons or a fabricator bay worked out its
 * center of mass meters off (the carrier with its 10 by 4 bay 0.77 m, the cannon drone 0.51 m).
 */
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** Logs the center of mass from the parts: once from each part's position, once from its middle. */
const WEIGH = `
function tick() {
  if (frame !== 3) return;
  var m = 0, ax = 0, ay = 0, cx = 0, cy = 0;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var a = p.angle + (p.rot * Math.PI) / 180;
    var x = p.pos.x + p.center.x * Math.cos(a) - p.center.y * Math.sin(a);
    var y = p.pos.y + p.center.x * Math.sin(a) + p.center.y * Math.cos(a);
    m += p.mass;
    ax += p.mass * p.pos.x;
    ay += p.mass * p.pos.y;
    cx += p.mass * x;
    cy += p.mass * y;
  }
  log(JSON.stringify([ax / m, ay / m, cx / m, cy / m]));
}`;

async function weigh(name: string): Promise<{ anchor: number; middle: number }> {
  const raw = resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw as { scripts?: unknown[] };
  raw.scripts = [{ id: 'weigh', source: WEIGH }];
  const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, flat);
  const r = w.spawnBlueprint(raw, { x: 0, y: 30 });
  for (let t = 0; t < 4; t++) w.step();
  const [ax, ay, cx, cy] = JSON.parse(w.scriptLogs.find((l) => l.robot === r.id)?.text ?? '[]') as number[];
  // The world's own: every body's mass and center, from its colliders (each cell an equal share of its part).
  let m = 0;
  let x = 0;
  let y = 0;
  for (const g of r.groups) {
    const mp = w.physics.massProperties(g.bodyId);
    m += mp.mass;
    x += mp.mass * mp.comX;
    y += mp.mass * mp.comY;
  }
  w.dispose();
  return { anchor: Math.hypot((ax as number) - x / m, (ay as number) - y / m), middle: Math.hypot((cx as number) - x / m, (cy as number) - y / m) };
}

describe('part.center (M16 review)', () => {
  for (const name of ['enemy-hunter-carrier', 'enemy-cannon-drone', 'enemy-fab-drone']) {
    it(`${name}: the parts' middles give the world's center of mass; their positions do not`, async () => {
      const { anchor, middle } = await weigh(name);
      expect(anchor).toBeGreaterThan(0.3);
      expect(middle).toBeLessThan(0.01);
    });
  }

  it('reads 0, 0 for a part of one cell, the middle of its cells for more, and cannot be changed', async () => {
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, flat);
    const src = `
function tick() {
  if (frame !== 1) return;
  var f = parts.filter(function (p) { return p.type === 'frame'; });
  var c = parts.filter(function (p) { return p.type === 'cannon'; })[0];
  try { c.center.x = 9; } catch (e) {}
  try { c.center = { x: 9, y: 9 }; } catch (e) {}
  log(JSON.stringify(f[0].center), f[0].center === f[1].center, JSON.stringify(c.center), Object.keys(c).join(' '));
}`;
    const r = w.spawnBlueprint({ format: 1, name: 'gunner', grid: ['F F C Cn> = = =', 'F F F =   = = ='], scripts: [{ id: 's', source: src }] }, { x: 0, y: 30 });
    for (let t = 0; t < 2; t++) w.step();
    expect(w.scriptLogs.filter((l) => l.robot === r.id).map((l) => l.text)).toEqual(['{"x":0,"y":0} true {"x":0.5,"y":1.5} id type tags pos angle mass in out rot on center spec']);
    w.dispose();
  });
});
