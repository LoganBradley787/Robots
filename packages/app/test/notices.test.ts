import { describe, expect, it } from 'vitest';
import { World, parseWorldFile, type Robot, type WorldEvent } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import missileJson from '../../../blueprints/missile-up.json';
import { eventNotice } from '../src/world/notices';

const flat = parseWorldFile(flatJson);
/** A ground base with a bay making `missile-up` (no scripts here, it only has to get out) on top: R lets go of what it holds. */
const bayBot = {
  format: 1,
  name: 'bay-bot',
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'densebattery', x: -1, y: 0 },
    { part: 'densebattery', x: 1, y: 0 },
    { part: 'fabbay', x: 0, y: 1, tags: ['bay'], makes: 'item' },
  ],
  recipes: { item: { ...missileJson, bindings: [], scripts: [] } },
  bindings: [{ key: 'r', mode: 'pulse', target: 'bay', channel: 'release', value: 1 }],
};
const coreOf = (r: Robot): string => r.primaryCoreId ?? '';
const destroy = (r: Robot, id: string): void => {
  const p = r.parts.get(id);
  if (!p) throw new Error(`no part ${id}`);
  p.health = 0;
};
const lost = (w: World, r: Robot): WorldEvent => {
  const ev = w.events.find((e) => e.kind === 'coreLost' && e.robot === r.id);
  if (!ev) throw new Error(`${r.id} never lost its core`);
  return ev;
};

/** A bay-bot and the copy it let go, flying free. */
async function released(): Promise<{ w: World; parent: Robot; copy: Robot }> {
  const w = await World.create({ seed: 1 }, flat);
  const parent = w.spawnBlueprint(bayBot, { x: -100, y: 0.5 });
  for (let t = 0; t < 260; t++) w.step();
  w.step([{ robot: parent.id, pressed: ['r'], released: [] }]);
  w.step([{ robot: parent.id, pressed: [], released: ['r'] }]);
  const woke = w.events.find((e) => e.kind === 'coreWoke');
  const copy = w.robots.find((r) => r.id === woke?.robot);
  if (!copy) throw new Error('no copy let go');
  return { w, parent, copy };
}

describe('notices about a piece that broke off another robot', () => {
  it('a copy that loses its core is not its parent losing its core (a fab bay)', async () => {
    const { w, parent, copy } = await released();
    expect(copy.name).toBe('bay-bot');
    destroy(copy, coreOf(copy));
    w.step();
    const ev = lost(w, copy);
    expect(w.canControl(parent.id)).toBe(true);
    expect(eventNotice(ev, copy, copy.id)).toBe('bay1 (a piece of bay-bot) lost its core: nobody controls it now, and it keeps doing what it was doing');
    w.dispose();
  });

  it('says nothing of one you are not following: pieces like it go by the dozen', async () => {
    const { w, parent, copy } = await released();
    destroy(copy, coreOf(copy));
    w.step();
    expect(eventNotice(lost(w, copy), copy, undefined)).toBeUndefined();
    expect(eventNotice(lost(w, copy), copy, parent.id)).toBeUndefined();
    w.dispose();
  });

  it('a piece with no scope of its own is called a piece', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const twin = w.spawnBlueprint({ format: 1, name: 'twin', grid: ['C  F  F  C'] }, { x: -100, y: 2 });
    const cores = [...twin.parts.values()].filter((p) => p.def.id === 'core');
    const frame = [...twin.parts.values()].find((p) => p.def.id === 'frame');
    destroy(twin, frame?.id ?? '');
    w.step();
    const piece = w.robots.find((r) => r.brokeFrom === twin.id && r.primaryCoreId !== undefined);
    if (!piece) throw new Error('no piece woke');
    expect(piece.primaryCoreId).toBe(cores[1]?.id);
    destroy(piece, coreOf(piece));
    w.step();
    expect(eventNotice(lost(w, piece), piece, piece.id)).toMatch(/^A piece of twin lost its core/);
    w.dispose();
  });

  it('names the piece in every other notice too, and only while followed', async () => {
    const { w, copy } = await released();
    const tick = w.tick;
    const empty: WorldEvent = { tick, robot: copy.id, kind: 'energyEmpty', chunk: 0 };
    const hot: WorldEvent = { tick, robot: copy.id, kind: 'overload', chunk: 0 };
    expect(eventNotice(empty, copy, copy.id)).toBe('bay1 (a piece of bay-bot) ran out of energy');
    expect(eventNotice(empty, copy, undefined)).toBeUndefined();
    expect(eventNotice(hot, copy, copy.id)).toBe('bay1 (a piece of bay-bot): reactor past its rating, heat is cooking its batteries');
    expect(eventNotice(hot, copy, undefined)).toBeUndefined();
    w.dispose();
  });

  it('a stopped script is told even when nobody follows the piece, under the name of the piece', async () => {
    const { w, copy } = await released();
    const ev: WorldEvent = { tick: w.tick, robot: copy.id, kind: 'scriptCrashed', script: 'guide', error: { kind: 'throw', message: 'boom' } };
    expect(eventNotice(ev, copy, undefined)).toBe('bay1 (a piece of bay-bot): script "guide" stopped. boom');
    w.dispose();
  });

  it('a piece gone off the edge of the world carries its own name in the event', async () => {
    const { w, copy } = await released();
    const fell: WorldEvent = { tick: w.tick, robot: copy.id, kind: 'fell', name: copy.name, team: 0, core: true, ...(copy.brokeFrom !== undefined ? { brokeFrom: copy.brokeFrom } : {}), ...(copy.scope !== undefined ? { scope: copy.scope } : {}) };
    expect(eventNotice(fell, undefined, copy.id)).toBe('bay1 (a piece of bay-bot) fell off the edge of the world');
    expect(eventNotice(fell, undefined, undefined)).toBeUndefined();
    w.dispose();
  });
});

describe('notices about a robot of its own', () => {
  it('read as they always did', async () => {
    const { w, parent } = await released();
    destroy(parent, coreOf(parent));
    w.step();
    expect(eventNotice(lost(w, parent), parent, undefined)).toBe('bay-bot lost its core: nobody controls it now, and it keeps doing what it was doing');
    const tick = w.tick;
    expect(eventNotice({ tick, robot: parent.id, kind: 'energyEmpty', chunk: 0 }, parent, undefined)).toBe('bay-bot ran out of energy');
    expect(eventNotice({ tick, robot: parent.id, kind: 'fell', name: 'bay-bot', team: 0, core: true }, undefined, undefined)).toBe('bay-bot fell off the edge of the world');
    expect(eventNotice({ tick, robot: parent.id, kind: 'fell', name: 'bay-bot', team: 1, core: true }, undefined, undefined)).toBeUndefined();
    expect(eventNotice({ tick, robot: parent.id, kind: 'fell', name: 'bay-bot', team: 0, core: false }, undefined, undefined)).toBeUndefined();
    w.dispose();
  });

  it('a core waking in a piece still names the robot it broke off', async () => {
    const { w, copy } = await released();
    const ev = w.events.find((e) => e.kind === 'coreWoke');
    if (!ev) throw new Error('no core woke');
    expect(eventNotice(ev, copy, undefined)).toBe('A core woke up in a piece that broke off bay-bot: click it to control it');
    w.dispose();
  });
});
