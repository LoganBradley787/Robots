import { describe, expect, it } from 'vitest';
import { parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import { formatReport, InvalidBlueprint, keysScriptsRead, runSim } from '../src/commands/run';
import { checkDeterminism } from '../src/commands/determinism';
import { validateCommand } from '../src/commands/validate';
import { showBlueprint } from '../src/commands/show';
import { formatReplay, replayCommand } from '../src/commands/replay';
import { buildReplay, defaultRegistry, expandBlueprint, placeBlueprint, toFileJson, World, type Blueprint } from '@robots/sim-core';
import { listBlueprints, readBlueprint, resolveBlueprint } from '../src/blueprintFiles';

const flat = parseWorldFile(flatJson);

describe('runSim', () => {
  it('samples the car once per second and ends at rest', async () => {
    const r = await runSim(flat, carJson, { seconds: 3, seed: 1, at: { x: 0, y: 3 } });
    expect(r.ticks).toBe(180);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[0]?.tick).toBe(60);
    expect(r.final.resting).toBe(true);
    expect(Math.abs(r.final.coreY - 1.45)).toBeLessThan(0.02);
    expect(r.finalHash).toMatch(/^[0-9a-f]{8}$/);
    expect(formatReport(r)).toContain('final: ticks=180');
  });

  it('drops a bomb on the robot and reports what broke (M6)', async () => {
    const longcar = { format: 1, name: 'longcar', grid: ['C  F  F  F  B  F', 'W  .  .  .  .  W'] };
    const bomb = { format: 1, name: 'bomb', grid: ['X'] };
    const r = await runSim(flat, longcar, { seconds: 6, seed: 1, at: { x: -100, y: 1.5 }, keys: [{ key: 'd', down: 0, up: 6 }], drops: [{ name: 'bomb', blueprint: bomb, t: 2, at: { x: -77, y: 4.95 } }] });
    expect(r.destruction.explosions).toBe(1);
    expect(r.destruction.destroyed).toContain('warhead@0,0');
    expect(r.destruction.pieces).toBe(2);
    expect(formatReport(r)).toContain('1 explosion   the robot is in 2 pieces');
  });

  it('refuses an invalid blueprint with its issues', async () => {
    await expect(runSim(flat, { format: 1, name: 'x', grid: ['C . F'] }, { seconds: 1, seed: 1 })).rejects.toBeInstanceOf(InvalidBlueprint);
  });

  it('drives with a key timeline and reports drive metrics', async () => {
    const r = await runSim(flat, carJson, { seconds: 3, seed: 1, at: { x: -20, y: 3 }, keys: [{ key: 'd', down: 0.5, up: 2.5 }] });
    expect(r.drive.distance).toBeGreaterThan(5);
    expect(r.drive.topSpeed).toBeGreaterThan(4);
    expect(formatReport(r)).toContain('drive: distance');
    const back = await runSim(flat, carJson, { seconds: 3, seed: 1, at: { x: -20, y: 3 }, keys: [{ key: 'a', down: 0.5, up: 2.5 }] });
    expect(back.drive.distance).toBeLessThan(-5);
  });

  it('warns about timeline keys the robot has no control on', async () => {
    const r = await runSim(flat, carJson, { seconds: 0.5, seed: 1, keys: [{ key: 'k', down: 0, up: 0.2 }] });
    expect(r.warnings).toEqual(["key 'k' does nothing on car (its keys: d, a)"]);
    expect(formatReport(r)).toContain("warning: key 'k'");
  });

  it('reports energy, and --unlimited keeps it full', async () => {
    const r = await runSim(flat, carJson, { seconds: 2, seed: 1, at: { x: -20, y: 3 }, keys: [{ key: 'd', down: 0, up: 2 }] });
    expect(r.energy.capacity).toBe(2100);
    expect(r.energy.used).toBeCloseTo(20, 0);
    expect(formatReport(r)).toContain('energy: used');
    const u = await runSim(flat, carJson, { seconds: 2, seed: 1, at: { x: -20, y: 3 }, keys: [{ key: 'd', down: 0, up: 2 }], unlimited: true });
    expect(u.energy.remaining).toBe(2100);
  });

  it('the same key timeline reproduces the same distance', async () => {
    const opts = { seconds: 4, seed: 1, at: { x: -20, y: 3 }, keys: [{ key: 'd', down: 0, up: 2 }, { key: 'a', down: 2.5, up: 3 }] };
    const a = await runSim(flat, carJson, opts);
    const b = await runSim(flat, carJson, opts);
    expect(a.drive).toEqual(b.drive);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('is deterministic', async () => {
    const d = await checkDeterminism(flat, carJson, { seconds: 3, seed: 2 });
    expect(d.equal).toBe(true);
  });
});

describe('run report: events, pieces, and the path plot (M7)', () => {
  // A pilot with a missile placed on its decoupler; the missile's script logs every tick.
  const railed = (): unknown => {
    const missile = expandBlueprint({ format: 1, name: 'missile', grid: ['C  G'], scripts: [{ id: 'say', source: "function tick() { log('flying'); }" }] }).blueprint as Blueprint;
    const rail = expandBlueprint({ format: 1, name: 'rail', grid: ['F  C  D>', 'W  .  W'], bindings: [{ key: 'f', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }] }).blueprint as Blueprint;
    const r = placeBlueprint(rail, missile, { x: 3, y: 1 }, defaultRegistry());
    if (!r.ok) throw new Error(r.error);
    return toFileJson(r.blueprint, defaultRegistry(), { inlineScripts: true });
  };

  it('lists what happened in order, with a letter per robot', async () => {
    const r = await runSim(flat, railed(), { seconds: 2, seed: 1, at: { x: -30, y: 2 }, keys: [{ key: 'f', down: 1, up: 1 }] });
    const kinds = r.events.map((e) => `${e.robot} ${e.kind}`);
    expect(kinds.slice(0, 5)).toEqual(['A key', 'A decoupled', 'A split', 'B woke', 'B log']);
    expect(r.events[0]?.text).toBe('key f tapped');
    expect(r.events[2]?.text).toBe('split: B broke off');
    expect(r.events[3]?.text).toMatch(/^woke: core@3,1 \(missile1\) runs its own controls; keys e, q; scripts say$/);
    const log = r.events[4];
    expect(log?.text).toBe('say: flying');
    expect(log?.repeats).toBeGreaterThan(10); // the world keeps a few log lines per second per robot
    expect(formatReport(r)).toMatch(/B {2}say: flying \(and \d+ more times until t=\d\.\d\d\)/);
  });

  it('reports every piece and draws their paths', async () => {
    const r = await runSim(flat, railed(), { seconds: 2, seed: 1, at: { x: -30, y: 2 }, keys: [{ key: 'f', down: 1, up: 1 }] });
    expect(r.pieces.map((p) => [p.mark, p.from, p.core])).toEqual([
      ['A', undefined, 'core@1,1'],
      ['B', 'A', 'core@3,1 (missile1)'],
    ]);
    expect(r.pieces[1]?.appearedAt).toBeCloseTo(1, 1);
    expect(r.pieces[0]?.track.length).toBeGreaterThan(15);
    const text = formatReport(r);
    expect(text).toMatch(/^ {2}B {2}broke off A at t=1\.0\d, core@3,1 \(missile1\): at \(/m);
    expect(r.plot.join('\n')).toMatch(/B/);
    expect(text).toContain('side view: 1 column =');
  });

  it('reports a key turning a script off and on', async () => {
    const drone = readBlueprint(resolveBlueprint('drone')).raw;
    const r = await runSim(flat, drone, { seconds: 1.5, seed: 1, keys: [{ key: 'h', down: 0.5, up: 0.5 }, { key: 'h', down: 1, up: 1 }] });
    expect(r.events.filter((e) => e.kind.startsWith('script')).map((e) => [e.t, e.text])).toEqual([
      [0.5, 'script hover turned off'],
      [1, 'script hover turned on'],
    ]);
  });

  it('does not warn about keys a script reads', async () => {
    expect(keysScriptsRead(["if (keys.down('w')) x(); keys.pressed(\"h\")"])).toEqual({ keys: new Set(['w', 'h']), any: false });
    expect(keysScriptsRead(['keys.down(k)']).any).toBe(true);
    const drone = readBlueprint(resolveBlueprint('drone')).raw;
    const r = await runSim(flat, drone, { seconds: 0.5, seed: 1, keys: [{ key: 'w', down: 0, up: 0.2 }, { key: 'k', down: 0, up: 0.2 }] });
    expect(r.warnings).toEqual(["key 'k' does nothing on drone (its keys: e, q, h, w, s, a, d)"]);
  });
});

describe('validate and show', () => {
  it('validate reports ok or issues', () => {
    expect(validateCommand(carJson)).toMatchObject({ ok: true, text: 'ok' });
    const bad = validateCommand({ format: 1, name: 'x', grid: ['C . F'] });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toEqual(['UNATTACHED']);
  });

  it('show prints the grid, mass, and body structure', () => {
    const shown = showBlueprint(carJson);
    expect(shown.ok).toBe(true);
    const text = shown.text;
    expect(text).toContain('car: 8 parts');
    expect(text).toContain('F F C B F F');
    expect(text).toContain('mass: 12.000 kg');
    expect(text).toContain('group 1: 1 part origin wheel@0,0 joint -> group 0');
    expect(showBlueprint({ format: 1, name: 'x', grid: ['C . F'] }).ok).toBe(false);
  });

  it('show prints the controls of every core (M7)', () => {
    const text = showBlueprint(readBlueprint(resolveBlueprint('launcher')).raw).text;
    expect(text).toContain('controls of core@4,1 (the primary core, active from deploy):');
    expect(text).toMatch(/controls of core@8,6 \(scope missile1[^\n]*active when its piece breaks off:\n {2}auto controls: on/);
    expect(text).toContain('    g script guide');
    expect(text).toContain('    guide: on, launcher.missile1.guide.js');
  });
});

describe('blueprint files', () => {
  it('resolves names in blueprints/', () => {
    expect(resolveBlueprint('car')).toMatch(/blueprints\/car\.json$/);
    expect(listBlueprints()).toContain('showcase');
    expect(() => resolveBlueprint('nope')).toThrow("no blueprint named 'nope'");
  });
});

describe('replay', () => {
  it('reruns a saved session and reports each robot', async () => {
    const w = await World.create({ seed: 1 }, flat);
    const car = w.spawnBlueprint(carJson, { x: -20, y: 3 });
    for (let i = 0; i < 180; i++) w.step(i === 5 ? [{ robot: car.id, pressed: ['d'], released: [] }] : []);
    const saved = JSON.parse(JSON.stringify(buildReplay(w)));
    w.dispose();
    const r = await replayCommand(saved);
    expect(r.matches).toBe(true);
    expect(r.robots).toHaveLength(1);
    expect(r.robots[0]?.drive.distance).toBeGreaterThan(3);
    expect(formatReplay(r)).toContain('MATCH');
    expect((await replayCommand({ ...saved, endHash: 'ffffffff' })).matches).toBe(false);
  });
});

describe('mirrorCommand (M7)', () => {
  it('flips the launcher in place and its missile flies the other way', async () => {
    const { mirrorCommand } = await import('../src/commands/mirror');
    const out = mirrorCommand(readBlueprint(resolveBlueprint('launcher')).raw, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('scripts are copied unchanged');
    const json = JSON.parse(out.text.slice(0, out.text.lastIndexOf('}') + 1));
    expect(json.primaryCore).toBe('core@5,1');
    expect(Object.keys(json.cores)).toEqual(['core@1,6']);
    const r = await runSim(flat, json, { seconds: 4, seed: 1, at: { x: 100, y: 1.5 }, keys: [{ key: 'f', down: 1, up: 1 }] });
    const missile = r.pieces.find((p) => p.core.includes('missile1'));
    expect(missile).toBeDefined();
    expect((missile?.final.x ?? 0) - (missile?.track[0]?.x ?? 0)).toBeLessThan(-10);
  });

  it('saves under a new name with its own script files', async () => {
    const { mirrorCommand } = await import('../src/commands/mirror');
    const out = mirrorCommand(readBlueprint(resolveBlueprint('launcher')).raw, { saveAs: 'rehcnual' });
    expect(out.files.map((f) => f.file)).toEqual(['rehcnual.json', 'rehcnual.missile1.guide.js']);
  });
});

describe('placeCommand (M7)', () => {
  const missile = { format: 1, name: 'missile', grid: ['C  X'], scripts: [{ id: 'arm', source: 'function tick() {}' }] };

  it('prints the target with a copy of the source placed on it', async () => {
    const { placeCommand } = await import('../src/commands/place');
    const out = placeCommand(carJson, missile, { at: { x: 2, y: 2 } });
    expect(out.ok).toBe(true);
    expect(out.files).toEqual([]);
    const json = JSON.parse(out.text.slice(0, out.text.lastIndexOf('}') + 1));
    expect(json.cores).toEqual({ 'core@2,2': { scope: 'missile1', scripts: [{ id: 'arm', source: 'function tick() {}' }] } });
    expect(out.text).toContain('placed missile as missile1');
  });

  it('saves under a new name with its own script files', async () => {
    const { placeCommand } = await import('../src/commands/place');
    const out = placeCommand(carJson, missile, { at: { x: 2, y: 2 }, saveAs: 'missile-car' });
    expect(out.files.map((f) => f.file)).toEqual(['missile-car.json', 'missile-car.missile1.arm.js']);
    expect(JSON.parse(out.files[0]?.text ?? '').name).toBe('missile-car');
  });

  it('notes when the copy lands below row 0, which the grid form cannot hold', async () => {
    const { placeCommand } = await import('../src/commands/place');
    const out = placeCommand(carJson, { format: 1, name: 'm', grid: ['C', 'X'] }, { at: { x: 1, y: -1 } });
    expect(out.text).toContain('note: parts landed left of column 0 or below row 0');
  });

  it('refuses an overlap', async () => {
    const { placeCommand } = await import('../src/commands/place');
    const out = placeCommand(carJson, missile, { at: { x: 0, y: 1 } });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/^cannot place: missile would overlap/);
  });
});
