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

// Measured on the tumbler (44 kg, 16 thrusters, 3 rad/s), hovering at 20 m, 3 s holds of each key at 12 m/s:
// - whole: height and x within 0.01 m, spin 3.00 throughout, moves 27 to 32 m per hold, 70 J/s hovering.
// - one thruster of a face shot off: within 0.1 m, spin 3.00 hovering (3.5 at worst on a key), moves 25 to 31 m.
// - a whole face shot off, a quarter of all it has: bobs about 1.2 m and 1.4 m, spin 3.0 to 3.5, moves 17 to 31 m.
// The tolerances below leave room around those.
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const load = (): unknown => resolveScripts(JSON.parse(bpFile('tumbler.json')), bpFile).raw;

const HZ = 60;
const faces = {
  bottom: [[1, 0], [2, 0], [4, 0], [5, 0]],
  top: [[1, 6], [2, 6], [4, 6], [5, 6]],
  left: [[0, 1], [0, 2], [0, 4], [0, 5]],
  right: [[6, 1], [6, 2], [6, 4], [6, 5]],
} as const;

interface Flight {
  w: World;
  r: Robot;
  parts: () => number;
  pose: () => { x: number; y: number; w: number; vx: number; vy: number };
  run: (seconds: number) => Span;
  hold: (key: string, seconds: number) => Span;
  lose: (cells: readonly (readonly [number, number])[]) => void;
}
interface Span {
  x: [number, number];
  y: [number, number];
  spin: [number, number];
  speed: number;
  moved: { x: number; y: number };
  energyPerSecond: number;
}

async function flight(y = 20): Promise<Flight> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const r = w.spawnBlueprint(load(), { x: -100, y });
  const pose = (): { x: number; y: number; w: number; vx: number; vy: number } => {
    const core = r.parts.get(r.primaryCoreId ?? '');
    const s = w.physics.state(r.groups[core?.group ?? 0]?.bodyId as number);
    return { x: s.x, y: s.y, w: s.w, vx: s.vx, vy: s.vy };
  };
  const span = (ticks: number, first?: string[], last?: string[]): Span => {
    const a = pose();
    const e0 = w.energy(r.id)?.stored ?? 0;
    const out: Span = { x: [a.x, a.x], y: [a.y, a.y], spin: [a.w, a.w], speed: 0, moved: { x: 0, y: 0 }, energyPerSecond: 0 };
    for (let i = 0; i < ticks; i++) {
      w.step(i === 0 && first ? [{ robot: r.id, pressed: first, released: [] }] : i === ticks - 1 && last ? [{ robot: r.id, pressed: [], released: last }] : undefined);
      const p = pose();
      out.x = [Math.min(out.x[0], p.x), Math.max(out.x[1], p.x)];
      out.y = [Math.min(out.y[0], p.y), Math.max(out.y[1], p.y)];
      out.spin = [Math.min(out.spin[0], p.w), Math.max(out.spin[1], p.w)];
      out.speed = Math.max(out.speed, Math.hypot(p.vx, p.vy));
    }
    const b = pose();
    out.moved = { x: b.x - a.x, y: b.y - a.y };
    out.energyPerSecond = (e0 - (w.energy(r.id)?.stored ?? 0)) / (ticks / HZ);
    return out;
  };
  return {
    w,
    r,
    parts: () => r.parts.size,
    pose,
    run: (seconds) => span(seconds * HZ),
    hold: (key, seconds) => span(seconds * HZ, [key], [key]),
    lose: (cells) => {
      for (const [x, y] of cells) {
        const p = r.parts.get(`thruster@${x},${y}`);
        if (!p) throw new Error(`no thruster at ${x},${y}`);
        p.health = 0;
      }
    },
  };
}

const directions = [
  ['w', 0, 1],
  ['s', 0, -1],
  ['d', 1, 0],
  ['a', -1, 0],
] as const;

/** Holds each key in turn, and checks it went that way, still tumbling, by at least `least` m. */
function fliesEveryWay(f: Flight, least: number): void {
  for (const [key, x, y] of directions) {
    const s = f.hold(key, 3);
    expect(s.moved.x * x + s.moved.y * y).toBeGreaterThan(least);
    expect(Math.abs(s.moved.x * y) + Math.abs(s.moved.y * x)).toBeLessThan(2.5);
    expect(s.spin[0]).toBeGreaterThan(2.4);
    expect(s.spin[1]).toBeLessThan(3.9);
    f.run(4);
  }
}

describe('tumbler', () => {
  it('tumbles for a minute in one place with no keys, and has energy left', async () => {
    const f = await flight();
    f.run(4);
    const s = f.run(60);
    expect(s.x[1] - s.x[0]).toBeLessThan(0.1);
    expect(s.y[1] - s.y[0]).toBeLessThan(0.1);
    expect(s.spin[0]).toBeGreaterThan(2.95);
    expect(s.spin[1]).toBeLessThan(3.05);
    expect(s.energyPerSecond).toBeLessThan(75);
    expect((f.w.energy(f.r.id)?.stored ?? 0) / s.energyPerSecond).toBeGreaterThan(100);
    f.w.dispose();
  });

  it('flies up, down, right and left while it tumbles', async () => {
    const f = await flight();
    f.run(4);
    fliesEveryWay(f, 25);
    f.w.dispose();
  });

  it('holds on after losing one thruster of a face', async () => {
    const f = await flight();
    f.run(4);
    f.lose([faces.bottom[0]]);
    f.run(4);
    const s = f.run(20);
    expect(s.x[1] - s.x[0]).toBeLessThan(0.3);
    expect(s.y[1] - s.y[0]).toBeLessThan(0.3);
    expect(s.spin[1] - s.spin[0]).toBeLessThan(0.1);
    fliesEveryWay(f, 23);
    f.w.dispose();
  });

  for (const face of ['bottom', 'top', 'left', 'right'] as const) {
    it(`keeps flying with its whole ${face} face gone`, async () => {
      const f = await flight();
      f.run(4);
      f.lose(faces[face]);
      f.run(4);
      const s = f.run(20);
      expect(s.x[1] - s.x[0]).toBeLessThan(2);
      expect(s.y[1] - s.y[0]).toBeLessThan(2);
      expect(s.spin[0]).toBeGreaterThan(2.9);
      fliesEveryWay(f, 15);
      f.w.dispose();
    });
  }

  it('deployed on the ground it climbs before it tumbles, and S stops it above the ground', async () => {
    const f = await flight(3.6);
    const parts = f.parts();
    const up = f.run(0.25);
    expect(Math.abs(up.spin[1])).toBeLessThan(0.1);
    f.run(4.75);
    expect(f.pose().w).toBeCloseTo(3, 1);
    f.hold('w', 2);
    f.run(3);
    const down = f.hold('s', 6);
    f.run(3);
    // Its tips reach 4.3 m from its center.
    expect(down.y[0]).toBeGreaterThan(4.6);
    expect(f.parts()).toBe(parts);
    f.w.dispose();
  });

  it('Q and E change the spin, and through zero to the other way', async () => {
    const f = await flight();
    f.run(4);
    f.hold('q', 2);
    f.run(2);
    expect(f.pose().w).toBeCloseTo(7, 0);
    f.hold('e', 5);
    f.run(2);
    expect(f.pose().w).toBeCloseTo(-3.5, 0);
    const s = f.run(4);
    expect(s.y[1] - s.y[0]).toBeLessThan(0.2);
    f.w.dispose();
  });
});
