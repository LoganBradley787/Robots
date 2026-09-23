import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { sampleRobot } from '../src/metrics/robotMetrics';

const sky = parseWorldFile({ name: 'sky', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });

describe('air drag', () => {
  it('a falling robot reaches a terminal speed', async () => {
    const w = await World.create({ seed: 1 }, sky);
    const r = w.spawnBlueprint({ format: 1, name: 'brick', grid: ['F  C  F'] }, { x: 0, y: 3000 });
    const speeds: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      w.step();
      if (i % 300 === 299) speeds.push(sampleRobot(w, r).speed);
    }
    // 4 kg over 3 cells: terminal speed sqrt(m g / (k * cells)) = sqrt(39.24 / 0.0075), about 72 m/s.
    expect(speeds[speeds.length - 1]).toBeCloseTo(Math.sqrt((4 * 9.81) / (0.0025 * 3)), 0);
    expect(Math.abs((speeds[speeds.length - 1] ?? 0) - (speeds[speeds.length - 2] ?? 0))).toBeLessThan(0.5);
    w.dispose();
  });

  it('the hopper under full thrust tops out instead of climbing forever', async () => {
    const w = await World.create({ seed: 1 }, sky);
    w.setUnlimitedEnergy(true);
    const r = w.spawnBlueprint({ format: 1, name: 'hop', grid: ['F  T^ C  B  T^ F', 'W  .  .  .  .  W'] }, { x: 0, y: 1.45 });
    w.step([{ robot: r.id, pressed: ['w'], released: [] }]);
    let top = 0;
    for (let i = 0; i < 60 * 40; i++) {
      w.step();
      top = Math.max(top, sampleRobot(w, r).speed);
    }
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(90);
    w.dispose();
  });
});
