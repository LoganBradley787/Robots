import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScannedPart, ScriptContact, ScriptHost, ScriptInstance, ScriptServices } from '../src/script/types';
import { contactHead, contactJson, contactMiddle, extrasJson, type ScriptFrame } from '../src/script/frame';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import type { Robot } from '../src/world/Robot';
import { partWorldPose } from '../src/metrics/robotMetrics';

/**
 * While a tick's scripts run, the world keeps what the sensor pass works out about each robot (where it is, its
 * sensors and radios, what it sees, its parts as a scan lists them) and shares it between viewers. These tests hold
 * every script to exactly what it would see with nothing kept: the same contacts in the same order, the same scan
 * text, tick after tick while robots move, lose parts, come apart, light flares, and jam.
 */

let inner: ScriptHost;
beforeAll(async () => {
  inner = await createQuickJsHost(variant);
});

/** No gravity, a small ground far below, no walls. Everything flies around y 300. */
const space = parseWorldFile({ name: 'space', ground: { width: 10, thickness: 2 }, spawn: { x: 0, y: 300 } });

interface Seen {
  /** The script's file name: `<script id>.js`, one per robot here. */
  name: string;
  /** Keys, contacts, and inbox as the JSON text the script is handed ('' when all are empty). */
  extras: string;
  contacts: ScriptContact[];
  /** Every `scan(id)` the script made, with the text it was handed. */
  scans: { id: number; text: string }[];
}

/** A host that notes what crosses into each script on each call: its contacts, and each scan's answer. */
function recording(): { host: ScriptHost; calls: Seen[] } {
  const calls: Seen[] = [];
  const wrap = (name: string, run: (frame: ScriptFrame, services?: ScriptServices) => ReturnType<ScriptInstance['tick']>) => (frame: ScriptFrame, services?: ScriptServices) => {
    const seen: Seen = { name, extras: frame.extras, contacts: frame.extras === '' ? [] : (JSON.parse(frame.extras) as [unknown, ScriptContact[], unknown])[1], scans: [] };
    calls.push(seen);
    if (!services) return run(frame);
    return run(frame, {
      scan: (id) => services.scan(id),
      scanJson: (id) => {
        const text = services.scanJson ? services.scanJson(id) : JSON.stringify(services.scan(id));
        seen.scans.push({ id, text });
        return text;
      },
      send: (to, json) => services.send(to, json),
    });
  };
  return {
    calls,
    host: {
      compile(source, opts) {
        const r = inner.compile(source, opts);
        if (!r.ok) return r;
        const i = r.instance;
        // Setup is not noted: it gets the same frame as the tick that follows it.
        return { ok: true, instance: { params: i.params, setup: (f, s) => i.setup(f, s), tick: wrap(opts.name, (f, s) => i.tick(f, s)), dispose: () => i.dispose() } };
      },
    },
  };
}

/** The world's own answers with nothing kept: asked outside the script pass, each is worked out afresh. */
interface Fresh {
  contactsFor(robot: Robot, remember: boolean): ScriptContact[];
  ownContacts(robot: Robot, remember: boolean, decoysOut: Map<number, { robot: Robot; partId: string }>): ScriptContact[];
}

/** A robot's parts as a scan lists them, from the public pose reader. */
function scanOf(w: World, r: Robot, only?: string): ScannedPart[] {
  const out: ScannedPart[] = [];
  for (const bp of r.blueprint.parts) {
    const p = r.parts.get(bp.id);
    if (!p || (only !== undefined && p.id !== only)) continue;
    const pose = partWorldPose(w, r, p.id);
    out.push({ id: p.id, type: p.def.id, pos: { x: pose.x, y: pose.y }, angle: pose.angle, health: p.health, maxHealth: p.def.health });
  }
  return out;
}

/** Scans every robot it sees, nearest first (the first four get an answer, the rest null). */
const LOOK = 'function tick() { for (var i = 0; i < contacts.length; i++) scan(contacts[i].id); }';
const looker = (n: number, grid: string, extra: Record<string, unknown> = {}): unknown => ({ format: 1, name: `bot${n}`, grid: [grid], scripts: [{ id: `look${n}`, source: LOOK }], ...extra });

/**
 * Steps once and checks every script call against answers worked out before the step with nothing kept (scripts run
 * first in a step, before anything moves). Returns the calls.
 */
function stepAndCheck(w: World, calls: Seen[], scripted: Map<string, Robot>, inputs: Parameters<World['step']>[0] = []): Seen[] {
  const fresh = w as unknown as Fresh;
  const expected = new Map<string, { contacts: ScriptContact[]; text: string; scans: Map<number, string> }>();
  for (const [name, robot] of scripted) {
    if (!w.robots.includes(robot) || robot.primaryCoreId === undefined) continue;
    const contacts = fresh.contactsFor(robot, false);
    const fooled = new Map<number, { robot: Robot; partId: string }>();
    const own = fresh.ownContacts(robot, false, fooled);
    const scans = new Map<number, string>();
    for (const c of contacts) {
      const mine = own.some((o) => o.id === c.id);
      const decoy = fooled.get(c.id);
      const target = decoy ? decoy.robot : w.robots.find((r) => r.id === c.id);
      scans.set(c.id, mine && target ? JSON.stringify(scanOf(w, target, decoy?.partId)) : 'null');
    }
    expected.set(name, { contacts: JSON.parse(JSON.stringify(contacts)) as ScriptContact[], text: JSON.stringify(contacts), scans });
  }
  calls.length = 0;
  w.step(inputs);
  for (const call of calls) {
    const want = expected.get(call.name);
    expect(want, call.name).toBeDefined();
    expect(call.contacts, `${call.name} contacts at tick ${w.tick}`).toEqual(want?.contacts);
    // The text itself, character for character (the order of a contact's fields is something a script can see).
    if (call.extras !== '') {
      const [keys, , inbox] = JSON.parse(call.extras) as [unknown, unknown, unknown];
      expect(call.extras).toBe(`[${JSON.stringify(keys)},${want?.text ?? ''},${JSON.stringify(inbox)}]`);
    }
    // The prelude hands the host only the first four scans of a tick.
    expect(call.scans.map((s) => s.id)).toEqual(call.contacts.slice(0, 4).map((c) => c.id));
    for (const s of call.scans) expect(s.text, `${call.name} scan(${s.id}) at tick ${w.tick}`).toBe(want?.scans.get(s.id));
  }
  return [...calls];
}

describe('what scripts see while the sensor pass shares its work', () => {
  it('contacts and scans match answers worked out afresh, every tick, through radios, a flare, a jammer, a split, and a lost part', async () => {
    const { host, calls } = recording();
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const scripted = new Map<string, Robot>();
    const add = (n: number, grid: string, at: { x: number; y: number }, team: number, extra: Record<string, unknown> = {}): Robot => {
      const r = w.spawnBlueprint(looker(n, grid, extra), at, { team });
      scripted.set(`look${n}.js`, r);
      return r;
    };
    const press = (...on: [string, string][]): Record<string, unknown> => ({ bindings: on.map(([target, channel]) => ({ key: 'v', mode: 'pulse', target, channel, value: 1 })) });
    // Team 0: radar and radio, radio only, radar only, and one with both that carries a jammer pod.
    const a = add(1, 'C  O  N  B', { x: 0, y: 300 }, 0);
    add(2, 'C  N  B', { x: -40, y: 320 }, 0);
    add(3, 'C  O  B', { x: 30, y: 280 }, 0);
    const jam = add(4, 'J  C  O  N  B', { x: -300, y: 300 }, 0, press(['jammer', 'ignite']));
    add(5, 'C  O  N  B', { x: 500, y: 350 }, 0);
    // Team 1: one that lights and lets go a flare to each side (a viewer is fooled by the nearer one), one that comes apart
    // in two, a few plain ones.
    const flarer = add(6, 'Q<  D<  C  O  D>  Q>', { x: 200, y: 300 }, 1, press(['flare', 'ignite'], ['decoupler', 'fire']));
    const splitter = add(7, 'O  C  B  D>  F  F  B', { x: 150, y: 260 }, 1, press(['decoupler', 'fire']));
    add(8, 'C  O  N  B', { x: 260, y: 330 }, 1);
    const plain = w.spawnBlueprint({ format: 1, name: 'plain', grid: ['C  B  F'] }, { x: 100, y: 340 }, { team: 1 });
    // Everything drifts, so a kept answer from the tick before would be wrong.
    w.robots.forEach((r, i) => w.kickRobot(r, 3 - i, i % 3, 0.05 * i));
    let scans = 0;
    let shared = 0;
    for (let t = 0; t < 45; t++) {
      const inputs = t === 8 ? [{ robot: flarer.id, pressed: ['v'], released: [] }] : t === 14 ? [{ robot: jam.id, pressed: ['v'], released: [] }] : t === 20 ? [{ robot: splitter.id, pressed: ['v'], released: [] }] : [];
      if (t === 26) {
        const lost = plain.parts.get('frame@2,0');
        if (lost) lost.health = 0;
      }
      for (const call of stepAndCheck(w, calls, scripted, inputs)) {
        scans += call.scans.filter((s) => s.text !== 'null').length;
        shared += call.contacts.filter((c) => c.by.join() === 'radio').length;
      }
    }
    // The scene did what it was built for.
    expect(w.events.some((e) => e.kind === 'lit')).toBe(true);
    expect(w.events.some((e) => e.kind === 'jamStarted')).toBe(true);
    expect(w.events.some((e) => e.kind === 'split' && e.robot === splitter.id)).toBe(true);
    expect(plain.parts.has('frame@2,0')).toBe(false);
    expect(scans).toBeGreaterThan(200);
    expect(shared).toBeGreaterThan(50);
    expect(a.parts.size).toBe(4);
    w.dispose();
  });

  it('two scripts scanning one robot on one tick are handed the same text, and the next tick a new one', async () => {
    const { host, calls } = recording();
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const target = w.spawnBlueprint({ format: 1, name: 'target', grid: ['C  B  F  F'] }, { x: 50, y: 300 }, { team: 1 });
    const scripted = new Map<string, Robot>();
    scripted.set('look1.js', w.spawnBlueprint(looker(1, 'C  O  B'), { x: 0, y: 300 }));
    scripted.set('look2.js', w.spawnBlueprint(looker(2, 'C  O  B'), { x: 0, y: 320 }));
    w.kickRobot(target, 5, 0);
    for (let i = 0; i < 3; i++) w.step();
    const first = stepAndCheck(w, calls, scripted);
    const texts = first.map((c) => c.scans.find((s) => s.id === target.id)?.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(texts[1]);
    expect((JSON.parse(texts[0] ?? '[]') as ScannedPart[]).map((p) => p.id)).toEqual(['core@0,0', 'battery@1,0', 'frame@2,0', 'frame@3,0']);
    // It moved: a tick later the text is another one.
    const second = stepAndCheck(w, calls, scripted);
    expect(second[0]?.scans.find((s) => s.id === target.id)?.text).not.toBe(texts[0]);
    w.dispose();
  });

  it('a lost part is gone from the next scan, a damaged one shows its health, and a piece that came off scans as itself', async () => {
    const { host, calls } = recording();
    const w = await World.create({ seed: 1, gravityY: 0, scripts: host }, space);
    const fire = [{ key: 'v', mode: 'pulse', target: 'decoupler', channel: 'fire', value: 1 }];
    const target = w.spawnBlueprint({ format: 1, name: 'target', grid: ['B  C  D>  F  F'], bindings: fire }, { x: 50, y: 300 }, { team: 1 });
    const scripted = new Map<string, Robot>([['look1.js', w.spawnBlueprint(looker(1, 'C  O  B'), { x: 0, y: 300 })]]);
    const ids = (call: Seen | undefined, id: number): string[] => (JSON.parse(call?.scans.find((s) => s.id === id)?.text ?? '[]') as ScannedPart[]).map((p) => p.id);
    for (let i = 0; i < 3; i++) w.step();
    expect(ids(stepAndCheck(w, calls, scripted)[0], target.id)).toEqual(['battery@0,0', 'core@1,0', 'decoupler@2,0', 'frame@3,0', 'frame@4,0']);
    // Damage shows on the next scan; at 0 the part is gone from the one after.
    const battery = target.parts.get('battery@0,0');
    if (!battery) throw new Error('no battery');
    battery.health = 7;
    const hurt = JSON.parse(stepAndCheck(w, calls, scripted)[0]?.scans.find((s) => s.id === target.id)?.text ?? '[]') as ScannedPart[];
    expect(hurt.find((p) => p.id === 'battery@0,0')?.health).toBe(7);
    battery.health = 0;
    stepAndCheck(w, calls, scripted);
    expect(ids(stepAndCheck(w, calls, scripted)[0], target.id)).toEqual(['core@1,0', 'decoupler@2,0', 'frame@3,0', 'frame@4,0']);
    // The decoupler lets the two frames go: they are a robot of their own from then on.
    stepAndCheck(w, calls, scripted, [{ robot: target.id, pressed: ['v'], released: [] }]);
    const after = stepAndCheck(w, calls, scripted)[0];
    const piece = w.robots.find((r) => r.brokeFrom === target.id);
    if (!piece) throw new Error('nothing came off');
    expect(ids(after, target.id)).toEqual(['core@1,0', 'decoupler@2,0']);
    expect(ids(after, piece.id)).toEqual(['frame@3,0', 'frame@4,0']);
    w.dispose();
  });

  it('a contact written from its pieces is JSON.stringify of it, whatever its numbers', () => {
    const odd = [0, -0, 1, -1, 0.1, 1 / 3, 1e21, 1e-7, 123456789.123456789, -2.5e-300, Number.MAX_VALUE, Number.MIN_VALUE, NaN, Infinity, -Infinity];
    const contacts: ScriptContact[] = [];
    for (let i = 0; i < odd.length; i++) {
      const n = (k: number): number => odd[(i + k) % odd.length] as number;
      contacts.push({ id: i + 1, side: (['enemy', 'friend', 'none'] as const)[i % 3] ?? 'none', core: i % 2 === 0, pos: { x: n(0), y: n(1) }, vel: { x: n(2), y: n(3) }, center: { x: n(4), y: n(5) }, mass: n(6), parts: i * 7, distance: n(7), by: i % 4 === 0 ? ['radio'] : ['radar@1,0', 'see"ker\\@2,0\n', 'é'] });
    }
    for (const c of contacts) expect(contactJson(contactHead(c.id, c.side, contactMiddle(c)), c.distance, c.by)).toBe(JSON.stringify(c));
    // And the extras around them.
    const keys = { down: ['w'], pressed: [], released: ['k'] };
    const inbox = [{ from: 'core@0,0', tick: 3, data: { a: [1, 'x'] } }];
    const text = `[${contacts.map((c) => JSON.stringify(c)).join(',')}]`;
    expect(extrasJson({ keys, contacts, inbox }, text)).toBe(extrasJson({ keys, contacts, inbox }));
    expect(extrasJson({ keys: { down: [], pressed: [], released: [] }, contacts: [], inbox: [] }, '[]')).toBe('');
  });

  it('a host without scanJson still gets the scan (the plain list)', () => {
    const r = inner.compile('function tick() { var l = scan(7); log(l === null ? "null" : l.length + ":" + l[0].id); }', { name: 't.js', seed: 1 });
    if (!r.ok) throw new Error(r.error.message);
    const frame: ScriptFrame = { layout: { id: 1, json: '[]' }, numbers: new Float64Array(13).fill(0), extras: '' };
    frame.numbers[0] = 1;
    const part: ScannedPart = { id: 'a', type: 'frame', pos: { x: 1, y: 2 }, angle: 0, health: 5, maxHealth: 10 };
    const plain = r.instance.tick(frame, { scan: (id) => (id === 7 ? [part] : null), send: () => false });
    expect(plain.ok && plain.logs).toEqual(['1:a']);
    const text = r.instance.tick(frame, { scan: () => null, scanJson: (id) => (id === 7 ? JSON.stringify([part, part]) : 'null'), send: () => false });
    expect(text.ok && text.logs).toEqual(['2:a']);
    r.instance.dispose();
  });
});
