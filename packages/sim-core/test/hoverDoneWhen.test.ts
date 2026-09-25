import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const deg = (r: number): number => (r * 180) / Math.PI;

function load(name: string, hoverParams?: Record<string, number>): unknown {
  const raw = JSON.parse(bpFile(`${name}.json`)) as { scripts: { id: string; params?: Record<string, number> }[] };
  if (hoverParams) for (const s of raw.scripts) if (s.id === 'hover') s.params = hoverParams;
  return resolveScripts(raw, bpFile).raw;
}

function driver(w: World, r: Robot): { angle: () => number; hold: (k: string, ticks: number) => void; wait: (ticks: number, each?: () => void) => void } {
  const body = (): number => r.groups[r.parts.get(r.primaryCoreId ?? '')?.group ?? 0]?.bodyId as number;
  const wait = (ticks: number, each?: () => void): void => {
    for (let i = 0; i < ticks; i++) {
      w.step();
      each?.();
    }
  };
  return {
    angle: () => deg(w.physics.state(body()).angle),
    hold: (k, ticks) => {
      w.step([{ robot: r.id, pressed: [k], released: [] }]);
      wait(ticks - 2);
      w.step([{ robot: r.id, pressed: [], released: [k] }]);
    },
    wait,
  };
}

describe('M8 fast hover fix (Gate 6, finding 6)', () => {
  // The turret drone with its turret swung level to one side: leaning toward that side overshot to 80 degrees at a
  // 60 degree lean, because braking was planned on the torque of the side that starts the lean, not the one that stops it.
  for (const [swing, lean, label] of [
    ['z', 'a', 'toward a load swung left'],
    ['z', 'd', 'away from a load swung left'],
    ['x', 'd', 'toward a load swung right'],
    ['x', 'a', 'away from a load swung right'],
  ] as const) {
    it(`leans 60 degrees ${label} without overshooting`, async () => {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const r = w.spawnBlueprint(load('turret-drone', { lean: 60, margin: 0.7 }), { x: 0, y: 12 });
      const d = driver(w, r);
      d.wait(60);
      d.hold(swing, 90);
      d.wait(90);
      let peak = 0;
      w.step([{ robot: r.id, pressed: [lean], released: [] }]);
      d.wait(120, () => {
        if (Math.abs(d.angle()) > Math.abs(peak)) peak = d.angle();
      });
      expect(Math.abs(peak)).toBeGreaterThan(55);
      expect(Math.abs(peak)).toBeLessThan(65);
      expect(Math.abs(d.angle())).toBeCloseTo(60, 0);
      w.dispose();
    });
  }

  it('the missile drones stay level after their first shot', async () => {
    for (const name of ['missile-drone', 'missile-drone-10prop']) {
      const w = await World.create({ seed: 1, scripts: host }, flat);
      const r = w.spawnBlueprint(load(name), { x: 0, y: 3 });
      const d = driver(w, r);
      d.wait(30);
      d.hold('w', 120);
      d.wait(180);
      d.hold('f', 2);
      let peak = 0;
      d.wait(240, () => {
        peak = Math.max(peak, Math.abs(d.angle()));
      });
      expect(peak).toBeLessThan(2);
      w.dispose();
    }
  });
});
