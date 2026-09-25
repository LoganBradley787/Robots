import { describe, expect, it } from 'vitest';
import flatJson from '../../../worlds/flat.json';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { buildReplay, parseReplay, runReplay } from '../src/replay/replayFile';

const flat = parseWorldFile(flatJson);
const BAR = { format: 1, name: 'bar', grid: ['C  F  F  C  F'] };

describe('teams (M8)', () => {
  it('a robot spawns on team 0 unless told otherwise, and pieces keep their parent team', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const mine = w.spawnBlueprint(BAR, { x: -20, y: 3 });
    const enemy = w.spawnBlueprint(BAR, { x: 20, y: 3 }, { team: 1 });
    expect(mine.team).toBe(0);
    expect(enemy.team).toBe(1);
    const cut = enemy.parts.get('frame@2,0');
    if (!cut) throw new Error('no frame');
    cut.health = 0;
    w.step();
    const pieces = w.robots.filter((r) => r.brokeFrom === enemy.id);
    expect(pieces.length).toBe(1);
    expect(pieces[0]?.team).toBe(1);
    w.dispose();
  });

  it('refuses a team that is not a whole number', async () => {
    const w = await World.create({ seed: 1 }, flat);
    expect(() => w.spawnBlueprint(BAR, { x: 0, y: 3 }, { team: -1 })).toThrow('team');
    expect(() => w.spawnBlueprint(BAR, { x: 0, y: 3 }, { team: 0.5 })).toThrow('team');
    w.dispose();
  });

  it('the team is state: the hash differs, and a replay carries it', async () => {
    const a = await World.create({ seed: 1 }, flat);
    const b = await World.create({ seed: 1 }, flat);
    a.spawnBlueprint(BAR, { x: 0, y: 3 });
    b.spawnBlueprint(BAR, { x: 0, y: 3 }, { team: 2 });
    expect(a.hash()).not.toBe(b.hash());
    for (let i = 0; i < 30; i++) b.step();
    const replay = parseReplay(JSON.parse(JSON.stringify(buildReplay(b))));
    expect(replay.spawns[0]?.team).toBe(2);
    const r = await runReplay(replay);
    expect(r.matches).toBe(true);
    expect(r.world.robots[0]?.team).toBe(2);
    r.world.dispose();
    a.dispose();
    b.dispose();
  });

  it('a replay made before teams loads every robot on team 0', async () => {
    const w = await World.create({ seed: 1 }, flat);
    w.spawnBlueprint(BAR, { x: 0, y: 3 });
    for (let i = 0; i < 10; i++) w.step();
    const replay = buildReplay(w);
    expect('team' in (replay.spawns[0] ?? {})).toBe(false);
    const r = await runReplay(parseReplay(JSON.parse(JSON.stringify(replay))));
    expect(r.matches).toBe(true);
    expect(r.world.robots[0]?.team).toBe(0);
    r.world.dispose();
    w.dispose();
  });
});
