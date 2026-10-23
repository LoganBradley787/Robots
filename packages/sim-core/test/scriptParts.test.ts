import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { expandBlueprint } from '../src/blueprint/expand';
import { toFileJson } from '../src/blueprint/serialize';
import { defaultRegistry } from '../src/parts/registry';
import { scriptNameIssues, scriptRuns } from '../src/script/reading';

/**
 * A script entry's `parts` (2026-10-23): a script that lists the part types and tags it reads sees only those parts,
 * in `parts` and in `get()`, so a big robot's frame carries a few rows instead of thousands.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const SHOW = `function tick() { if (frame === 1) log(parts.map(function (p) { return p.type + (p.tags.indexOf('wing') >= 0 ? ':wing' : ''); }).join(' ') + ' | ' + get('thruster', 'throttle') + ' ' + get('core', 'energy')); }`;

const lifter = (scripts: unknown[]): unknown => ({
  format: 1,
  name: 'lifter',
  grid: ['F  T^ C  T^ F'],
  legend: { F: { part: 'frame', tags: ['wing'] } },
  scripts,
});

async function logsOf(bp: unknown): Promise<string[]> {
  const w = await World.create({ seed: 1, scripts: host }, open);
  const r = w.spawnBlueprint(bp, { x: 0, y: 1 });
  w.step();
  w.step();
  const out = w.scriptLogs.filter((l) => l.robot === r.id).map((l) => `${l.script}: ${l.text}`);
  w.dispose();
  return out;
}

describe("a script entry's parts", () => {
  it('a script that lists its parts sees only those, by type or by tag, in parts and in get()', async () => {
    expect(await logsOf(lifter([{ id: 'a', parts: ['thruster', 'wing'], source: SHOW }]))).toEqual(['a: frame:wing thruster thruster frame:wing | 0 undefined']);
  });

  it('without a list, or when any script of the core lists none, every part is there', async () => {
    const all = 'a: frame:wing thruster core thruster frame:wing | 0 ';
    expect((await logsOf(lifter([{ id: 'a', source: SHOW }])))[0]).toMatch(new RegExp(`^${all.replace(/[|+]/g, '\\$&')}`));
    const two = await logsOf(lifter([{ id: 'a', parts: ['thruster'], source: SHOW }, { id: 'b', source: 'function tick() {}' }]));
    expect(two[0]).toMatch(new RegExp(`^${all.replace(/[|+]/g, '\\$&')}`));
  });

  it("every script of a core sees what any of them lists", async () => {
    const logs = await logsOf(lifter([{ id: 'a', parts: ['thruster'], source: SHOW }, { id: 'b', parts: ['core'], source: 'function tick() {}' }]));
    expect(logs[0]).toMatch(/^a: thruster core thruster \| 0 \d/);
  });

  it('is read from and written back to the file, and a bad one is an error', () => {
    const reg = defaultRegistry();
    const r = expandBlueprint(lifter([{ id: 'a', parts: ['gun', 'gun', 'bay'], source: 'function tick() {}' }]));
    expect(r.blueprint?.scripts[0]?.parts).toEqual(['gun', 'bay']);
    expect((toFileJson(r.blueprint!, reg).scripts as { parts?: string[] }[])[0]?.parts).toEqual(['gun', 'bay']);
    for (const bad of [[], 'gun', [''], [3]]) {
      const e = expandBlueprint(lifter([{ id: 'a', parts: bad, source: 'function tick() {}' }]));
      expect(e.issues.map((i) => i.code)).toContain('BAD_SCRIPT');
    }
  });

  it('the validator warns about names the code reads that the list leaves out, and listed names that reach nothing', () => {
    const reg = defaultRegistry();
    const src = "function tick() {\n  set('thruster', 'throttle', 1);\n  get('thruster', 'throttle');\n  for (const p of parts) if (p.type === 'frame' || p.tags.includes('wing')) log(1);\n}";
    const b = expandBlueprint(lifter([{ id: 'a', parts: ['frame', 'thrustr'], source: src }])).blueprint!;
    const issues = scriptRuns(b).flatMap((r) => scriptNameIssues(r, reg).map((i) => `${i.code}: ${i.message}`));
    expect(issues).toEqual([
      "SCRIPT_PARTS: script 'a' lists 'thrustr' in its parts, but no part has that tag or part type; did you mean 'thruster'?",
      "SCRIPT_PARTS: script 'a' line 3: get('thruster', ...) reads parts its parts list ('frame', 'thrustr') leaves out, so it sees none of them: add 'thruster' to the script's parts",
    ]);
  });
});
