import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import { inputToFrame } from '../src/script/frame';
import type { ScriptHost, ScriptInput } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';

/**
 * M16: `part.rot` and `part.on` in scripts (`script/frame.ts`, `LayoutPart`): how a part was built turned, and the
 * joint part that carries it. With `spec.acts` they are what a shared behavior needs to know which way a lifter
 * pushes and which hinge aims which gun, on a robot it has never seen.
 */
const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** What the script of `bp` logs on its first tick, parsed. */
async function said(bp: unknown): Promise<unknown> {
  const w = await World.create({ seed: 1, scripts: host }, flat);
  const r = w.spawnBlueprint(bp, { x: 0, y: 20 });
  w.step();
  const line = w.scriptLogs.find((l) => l.robot === r.id)?.text;
  w.dispose();
  return JSON.parse(line ?? 'null');
}

/** Each part's type, rot and on, and the keys every part has (a log line is at most 300 characters). */
const LIST = `function tick() { if (!state.done) { state.done = true; const k = (p) => Object.keys(p).join(); log(JSON.stringify([parts.every((p) => k(p) === k(parts[0])) && k(parts[0]), parts.map((p) => [p.type, p.rot, p.on])])); } }`;
const SHORT = `function tick() { if (!state.done) { state.done = true; log(JSON.stringify(parts.map((p) => [p.type, p.rot, p.on]))); } }`;

describe('part.rot and part.on (M16)', () => {
  it('a gun on a hinge reads the hinge; the hinge and the body read nothing; rot is the blueprint rotation', async () => {
    const bp = {
      format: 1,
      name: 'one',
      grid: ['g  .', 'r  .', 'C  p'],
      legend: { r: { part: 'rotator', rot: 0, auto: false }, g: { part: 'gun', rot: 0 }, p: { part: 'propeller', rot: 270 } },
      scripts: [{ id: 'a', source: LIST }],
    };
    // `center` (M16 review) comes with rot and on.
    expect(await said(bp)).toEqual([
      'id,type,tags,pos,angle,mass,in,out,rot,on,center,spec',
      [
        ['gun', 0, 'rotator@0,1'],
        ['rotator', 0, ''],
        ['core', 0, ''],
        ['propeller', 270, ''],
      ],
    ]);
  });

  it('a chain of hinges is walked one `on` at a time, and what is welded to a carried part is carried too', async () => {
    const bp = {
      format: 1,
      name: 'chain',
      grid: ['F  g', 'b  .', 'a  .', 'C  .'],
      legend: { a: { part: 'rotator', rot: 0, auto: false }, b: { part: 'rotator', rot: 0, auto: false }, g: { part: 'gun', rot: 270 } },
      scripts: [{ id: 'a', source: SHORT }],
    };
    const got = (await said(bp)) as [string, number, string][];
    const by = (type: string): [string, number, string] => got.find((p) => p[0] === type) as [string, number, string];
    expect(by('gun').slice(1, 3)).toEqual([270, 'rotator@0,2']);
    expect(by('frame').slice(1, 3)).toEqual([0, 'rotator@0,2']);
    expect(got.filter((p) => p[0] === 'rotator').map((p) => p[2])).toEqual(['rotator@0,1', '']);
  });

  it('a wheel is its own joint: it reads what carries the part it is mounted on', async () => {
    const bp = { format: 1, name: 'cart', grid: ['C  F', 'W  W'], scripts: [{ id: 'a', source: SHORT }] };
    const got = (await said(bp)) as [string, number, string][];
    expect(got.map((p) => p[2])).toEqual(['', '', '', '']);
  });

  it('the way a part acts is its body angle plus rot and spec.acts: a propeller turned to push right', async () => {
    const code = `function tick() { if (frame !== 1) return; const p = parts.find((q) => q.type === 'propeller'); log(JSON.stringify([p.spec.acts, p.rot, Math.round(Math.cos(p.angle + (p.rot + p.spec.acts) * Math.PI / 180) * 1000) / 1000])); }`;
    const bp = { format: 1, name: 'push', grid: ['C  p'], legend: { p: { part: 'propeller', rot: 270 } }, scripts: [{ id: 'a', source: code }] };
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const r = w.spawnBlueprint(bp, { x: 0, y: 20 });
    w.step();
    w.step();
    expect(JSON.parse(w.scriptLogs.find((l) => l.robot === r.id)?.text ?? 'null')).toEqual([90, 270, 1]);
    w.dispose();
  });

  it('a part of a layout built by hand without them has no such keys, as before M16', () => {
    const input: ScriptInput = {
      frame: 1,
      dt: 1 / 60,
      time: 0,
      self: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0, mass: 1, energy: { stored: 0, capacity: 0 } },
      parts: [{ id: 'a', type: 'frame', tags: ['a'], pos: { x: 0, y: 0 }, angle: 0, mass: 1, in: {}, out: {} }],
      keys: { down: [], pressed: [], released: [] },
      contacts: [],
      inbox: [],
    };
    const compile = (): { tick: (i: ScriptInput) => number[] } => {
      const r = host.compile(`function tick() { set('x', 'rot', 'rot' in parts[0] ? parts[0].rot : -1); set('x', 'on', parts[0].on === 'j' ? 1 : 0); parts[0].rot = 5; }`, { name: 't', seed: 1 });
      if (!r.ok) throw new Error(r.error.message);
      return {
        tick: (i) => {
          const out = r.instance.tick(inputToFrame(i, i.frame));
          if (!out.ok) throw new Error(out.error.message);
          return out.writes.map((x) => x.value);
        },
      };
    };
    expect(compile().tick(input)).toEqual([-1, 0]);
    const mounted = { ...input, parts: [{ ...(input.parts[0] as ScriptInput['parts'][number]), rot: 180, on: 'j' }] };
    const s = compile();
    expect(s.tick(mounted)).toEqual([180, 1]);
    // Read-only, like a part's id: the script's own write did not stick.
    expect(s.tick({ ...mounted, frame: 1 })).toEqual([180, 1]);
  });
});
