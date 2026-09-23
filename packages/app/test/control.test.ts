import { describe, expect, it } from 'vitest';
import { KeyboardSource } from '../src/control/KeyboardSource';
import { isClick, nextRobot } from '../src/control/possession';

describe('KeyboardSource', () => {
  it('sends nothing while no robot is controlled', () => {
    const k = new KeyboardSource();
    k.down('keyboard', 'd');
    expect(k.drain()).toEqual([]);
  });

  it('turns downs and ups into edges for the controlled robot, drained once', () => {
    const k = new KeyboardSource();
    k.setControlled(3);
    k.down('keyboard', 'd');
    k.down('keyboard', 'a');
    k.up('keyboard', 'd');
    expect(k.drain()).toEqual([{ robot: 3, pressed: ['d', 'a'], released: ['d'] }]);
    expect(k.drain()).toEqual([]);
  });

  it('a key held by keyboard and mouse is released when both let go', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.down('mouse', 'd');
    k.up('keyboard', 'd');
    expect(k.drain()).toEqual([{ robot: 1, pressed: ['d'], released: [] }]);
    k.up('mouse', 'd');
    expect(k.drain()).toEqual([{ robot: 1, pressed: [], released: ['d'] }]);
  });

  it('switching robots latches the old one and starts the new one with nothing held', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.setControlled(2);
    k.up('keyboard', 'd'); // released after switching: not sent to either robot
    k.down('keyboard', 'a');
    expect(k.drain()).toEqual([
      { robot: 1, pressed: ['d'], released: [] },
      { robot: 2, pressed: ['a'], released: [] },
    ]);
  });

  it('a key held through a switch counts only once pressed again', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.drain();
    k.setControlled(2);
    k.down('keyboard', 'd'); // key repeat is filtered upstream; a fresh press after release is what counts
    expect(k.drain()).toEqual([{ robot: 2, pressed: ['d'], released: [] }]);
  });

  it('releaseAll releases every held key on the controlled robot', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.down('mouse', 'w');
    k.drain();
    k.releaseAll();
    expect(k.drain()).toEqual([{ robot: 1, pressed: [], released: ['d', 'w'] }]);
    expect(k.isDown('d')).toBe(false);
  });

  it('clear drops pending edges and control', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.clear();
    expect(k.drain()).toEqual([]);
    expect(k.robot).toBeUndefined();
  });
});

describe('possession', () => {
  const robots = [
    { id: 1, controllable: true },
    { id: 2, controllable: false },
    { id: 3, controllable: true },
  ];

  it('cycles through controllable robots, skipping core-less ones', () => {
    expect(nextRobot(robots, 1)).toBe(3);
    expect(nextRobot(robots, 3)).toBe(1);
    expect(nextRobot(robots, undefined)).toBe(1);
  });

  it('cycles the camera through every robot when none can be controlled', () => {
    const debris = [
      { id: 4, controllable: false },
      { id: 5, controllable: false },
    ];
    expect(nextRobot(debris, 4)).toBe(5);
    expect(nextRobot([], undefined)).toBeUndefined();
  });

  it('tells clicks from drags', () => {
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(false);
  });
});
