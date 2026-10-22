import { describe, expect, it } from 'vitest';
import { buildInspect, energyText, massText, positionText, velocityText } from '../src/world/inspect';

describe('the followed robot in the left panel', () => {
  const enemy = buildInspect({ name: 'titan-mirage', team: 1, driving: false, x: 412.349, y: 6.06, speed: 23.44, energy: { stored: 2480.9, capacity: 4000 }, parts: 38, massKg: 4120.4 });

  it('says whose it is, in its team color, and that you only watch an enemy', () => {
    expect(enemy.teamName).toBe('Enemy');
    expect(enemy.color).toBe('#ff8a80');
    expect(enemy.driving).toBe(false);
    const mine = buildInspect({ name: 'car', team: 0, driving: true, x: 0, y: 0, speed: 0, parts: 4, massKg: 80 });
    expect(mine.teamName).toBe('Yours');
    expect(mine.energy).toBeUndefined();
  });

  it('rounds what it shows, so the view only changes when a shown number does', () => {
    expect(enemy).toMatchObject({ x: 412.3, y: 6.1, speed: 23.4, energy: { stored: 2480, capacity: 4000 }, massKg: 4120 });
    expect(buildInspect({ name: 'a', team: 0, driving: true, x: 412.31, y: 6.09, speed: 23.42, parts: 1, massKg: 1 })).toMatchObject({ x: 412.3, y: 6.1, speed: 23.4 });
  });

  it('reads as short text', () => {
    expect(positionText(enemy)).toBe('x 412.3  y 6.1 m');
    expect(positionText({ x: -3, y: 0 })).toBe('x -3.0  y 0.0 m');
    expect(velocityText(enemy)).toBe('23.4 m/s');
    expect(massText(840)).toBe('840 kg');
    expect(massText(12_400)).toBe('12.4 t');
    expect(energyText({ stored: 2480, capacity: 4000 }, false)).toBe('2,480 of 4,000');
    expect(energyText({ stored: 0, capacity: 0 }, false)).toBe('none');
    expect(energyText({ stored: 10, capacity: 4000 }, true)).toBe('no limit');
  });
});
