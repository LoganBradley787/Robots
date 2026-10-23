import { describe, expect, it } from 'vitest';
import { World, buildReplay, parseReplay, parseWorldFile, runReplay } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
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
    // The release of D comes after its press, so it starts a new entry (order is kept within a tick).
    expect(k.drain()).toEqual([
      { robot: 3, pressed: ['d', 'a'], released: [] },
      { robot: 3, pressed: [], released: ['d'] },
    ]);
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

  it('following a robot you only watch releases the held keys of the one you drove; following one you drive latches it', () => {
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    k.down('mouse', 'w');
    k.follow(2);
    expect(k.drain()).toEqual([{ robot: 1, pressed: ['d', 'w'], released: [] }]);
    k.down('keyboard', 'a');
    k.follow(undefined);
    expect(k.drain()).toEqual([
      { robot: 2, pressed: ['a'], released: [] },
      { robot: 2, pressed: [], released: ['a'] },
    ]);
    expect(k.robot).toBeUndefined();
    expect(k.isDown('a')).toBe(false);
  });

  it('the release reaches the world and its replay: the car you leave to watch an enemy stops driving', async () => {
    const w = await World.create({ seed: 1 }, parseWorldFile(flatJson));
    const car = w.spawnBlueprint(carJson, { x: 0, y: 2 });
    w.spawnBlueprint(carJson, { x: 30, y: 2 }, { team: 1 });
    const speeds = (): number[] => [...(w.robotChannels(car.id)?.values() ?? [])].map((c) => c.get('speed')).filter((v) => v !== undefined);
    const k = new KeyboardSource();
    k.follow(car.id);
    k.down('keyboard', 'd');
    for (let i = 0; i < 30; i++) w.step(k.drain());
    expect(speeds().length).toBeGreaterThan(0);
    expect(speeds().every((v) => v === 1)).toBe(true);
    // Clicking the enemy: `WorldScreen.focus` follows a robot you cannot drive.
    k.follow(undefined);
    k.up('keyboard', 'd'); // letting go of D afterwards sends nothing more
    for (let i = 0; i < 30; i++) w.step(k.drain());
    expect(speeds().every((v) => v === 0)).toBe(true);
    const replay = buildReplay(w);
    expect(replay.inputs.flatMap((t) => t.inputs.flatMap((i) => i.released))).toEqual(['d']);
    const r = await runReplay(parseReplay(JSON.parse(JSON.stringify(replay))));
    expect(r.matches).toBe(true);
    r.world.dispose();
    w.dispose();
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

describe('KeyboardSource ordering within a tick', () => {
  it('release then press again in one tick leaves the key held on the robot', async () => {
    const { Controller } = await import('@robots/sim-core');
    const k = new KeyboardSource();
    k.setControlled(1);
    k.down('keyboard', 'd');
    const c = new Controller([], []);
    for (const i of k.drain()) c.apply(i.pressed, i.released);
    c.endTick();
    k.up('keyboard', 'd');
    k.down('keyboard', 'd');
    const tick = k.drain();
    expect(tick).toEqual([
      { robot: 1, pressed: [], released: ['d'] },
      { robot: 1, pressed: ['d'], released: [] },
    ]);
    for (const i of tick) c.apply(i.pressed, i.released);
    expect(c.isHeld('d')).toBe(true);
  });

  it('two taps of a toggle in one tick flip it twice', async () => {
    const { Controller } = await import('@robots/sim-core');
    const k = new KeyboardSource();
    k.setControlled(1);
    const c = new Controller([{ key: 't', mode: 'toggle', target: 'x', channel: 'throttle', value: 1 }], []);
    k.down('mouse', 't');
    k.up('mouse', 't');
    k.down('mouse', 't');
    k.up('mouse', 't');
    for (const i of k.drain()) c.apply(i.pressed, i.released);
    expect(c.state().toggles).toEqual([]);
  });
});
