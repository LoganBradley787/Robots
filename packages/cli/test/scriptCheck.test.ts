import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatIssues } from '@robots/sim-core';
import { calls, scriptIssues } from '../src/commands/scriptCheck';
import { validateWithScripts } from '../src/commands/validate';
import { listBlueprints, loadBlueprintFile } from '../src/blueprintFiles';
import { draftFolder, sim } from './cli';

/** A car with tagged wheels and this drive script. */
const car = (source: string): unknown => ({ format: 1, name: 'x', grid: ['C  F  F', 'W  .  W'], legend: { W: { part: 'wheel', tags: ['wheels'] } }, scripts: [{ id: 'drive', source, file: 'x.drive.js' }] });
const lines = async (source: string): Promise<string[]> => formatIssues(await scriptIssues(car(source))).split('\n').filter((l) => l !== '');

describe('calls', () => {
  it('finds set and get with the line and the arguments written as plain strings', () => {
    const src = ["function tick() {", "  set('wheels', 'speed', 1);", '  const a = get("core", "energy") + get(tag, \'angle\');', "  set('grip' + k, name, 1);", '}'].join('\n');
    expect(calls(src)).toEqual([
      { fn: 'set', line: 2, target: 'wheels', channel: 'speed' },
      { fn: 'get', line: 3, target: 'core', channel: 'energy' },
      { fn: 'get', line: 3, channel: 'angle' },
      { fn: 'set', line: 4 },
    ]);
  });

  it('skips comments, strings, templates, regexes, methods and other names', () => {
    const src = [
      "// set('a', 'b', 1)",
      "/* get('a', 'b') */",
      "const s = \"set('a', 'b', 1)\" + `get('a', 'b') ${ok ? `set('c', 'd')` : 1}`;",
      "const r = /set\\('a', 'b'/.test(s) ? map.get('a', 'b') : offset('a', 'b');",
      "state.set('a', 'b'); reset('a', 'b'); const half = total / 2; set('wheels', 'speed', half / 2);",
    ].join('\n');
    expect(calls(src)).toEqual([{ fn: 'set', line: 5, target: 'wheels', channel: 'speed' }]);
  });

  it("leaves a script's own set or get alone", () => {
    expect(calls("function get(a, b) { return 1; }\nget('x', 'y'); set('wheels', 'speed', 1);")).toEqual([{ fn: 'set', line: 2, target: 'wheels', channel: 'speed' }]);
    expect(calls("const set = (a, b) => 0;\nset('x', 'y');")).toEqual([]);
  });

  it('reads an argument that spans calls and brackets as not plain', () => {
    expect(calls("set(pick([1, 2], f('a', 'b')), 'speed', 1); get(names[0])")).toEqual([{ fn: 'set', line: 1, channel: 'speed' }, { fn: 'get', line: 1 }]);
  });
});

describe('scriptIssues (review T2)', () => {
  it('passes a script that drives parts the robot has', async () => {
    expect(await lines("function tick() { set('wheels', 'speed', 1); set('wheel', 'speed', 1); set('wheel@0,0', 'speed', get('core', 'energy') > 0 ? 1 : 0); }")).toEqual([]);
  });

  it('warns when a script reads contacts and nothing on the robot sees (M16)', async () => {
    expect(await lines("function tick() {\n  if (contacts.length > 0) set('wheels', 'speed', 1);\n}")).toEqual([
      "warning SCRIPT_SEES: script 'drive' (x.drive.js) line 2: contacts is always empty here. Nothing on this robot sees: add a part that does, such as a radar.",
    ]);
    const seeing = { format: 1, name: 'x', grid: ['C  F  Ra', 'W  .  W'], legend: { W: { part: 'wheel', tags: ['wheels'] }, Ra: { part: 'radar' } }, scripts: [{ id: 'drive', source: "function tick() { set('wheels', 'speed', contacts.length); }" }] };
    expect(await scriptIssues(seeing)).toEqual([]);
  });

  it('reports a syntax error with its line', async () => {
    expect(await lines('function tick() {\n  set(;\n}')).toEqual([expect.stringMatching(/^warning SCRIPT_SYNTAX: script 'drive' \(x\.drive\.js\) does not compile and would stop at t=0: SyntaxError: .* \(line 2\)$/)]);
  });

  it('reports a script with no tick', async () => {
    expect(await lines('function tock() {}')).toEqual(["warning SCRIPT_NO_TICK: script 'drive' (x.drive.js) does not define function tick() and would stop at t=0"]);
  });

  it('reports a script that throws or never ends as it starts', async () => {
    expect(await lines('nothing.here = 1;\nfunction tick() {}')).toEqual([expect.stringMatching(/^warning SCRIPT_ERROR: script 'drive' \(x\.drive\.js\) stops as it starts: .*nothing/)]);
    expect(await lines('while (true) {}\nfunction tick() {}')).toEqual([expect.stringMatching(/^warning SCRIPT_ERROR: script 'drive' \(x\.drive\.js\) stops as it starts: ran too long/)]);
  });

  it('reports a target no part answers to, with its line, the nearest name, and the real names', async () => {
    expect(await lines("function tick() {\n\n  set('wheelz', 'speed', 1);\n}")).toEqual([
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 3: set('wheelz', ...) reaches nothing: no part has that tag, part type, or id; did you mean 'wheels'? (tags here: wheels; part types here: wheel, core, frame)",
    ]);
  });

  it('reports every plain name that reaches nothing (M16): a tag the robot lacks, and a part type it lacks too', async () => {
    // Until M16 these were left alone (a script shared between robots reaches for names only some carry), and a
    // robot whose script drove nothing printed `ok`.
    const said = await lines("function tick() {\n  set('wheels', 'speed', 1);\n  set('wheelz', 'speed', 1);\n  if (get('bay', 'ready') > 0) set('bay', 'release', 1);\n  set('gun', 'fire', 1);\n}");
    expect(said.map((l) => l.replace(/ \(tags here: .*$/, ''))).toEqual([
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 3: set('wheelz', ...) reaches nothing: no part has that tag, part type, or id; did you mean 'wheels'?",
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 4: get('bay', ...) reaches nothing: no part has that tag, part type, or id",
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 4: set('bay', ...) reaches nothing: no part has that tag, part type, or id",
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 5: set('gun', ...) reaches nothing: no part has that tag, part type, or id",
    ]);
    for (const l of said) expect(l).toMatch(/ \(tags here: wheels; part types here: (core|frame|wheel), (core|frame|wheel), (core|frame|wheel)\)$/);
  });

  it('leaves alone a part type the script drives as one of several, and still says one it drives alone', async () => {
    // `wheel` is there and takes `speed`: `thruster` with `speed` is the other half of "whichever it has".
    expect(await lines("function tick() { set('wheel', 'speed', 1); set('thruster', 'speed', 1); }")).toEqual([]);
    // Another input is another call: nothing on the robot takes `throttle` from this script.
    expect((await lines("function tick() { set('wheel', 'speed', 1); set('thruster', 'throttle', 1); }")).map((l) => l.replace(/ \(tags here: .*$/, ''))).toEqual([
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 1: set('thruster', ...) reaches nothing: no part has that tag, part type, or id",
    ]);
    // A tag is never one of several: `wheelz` beside a working `wheels` is still a mistake.
    expect(await lines("function tick() { set('wheels', 'speed', 1); set('wheelz', 'speed', 1); }")).toHaveLength(1);
  });

  it('says once what copies of one script share, with the count and who runs them', async () => {
    const guide = "function tick() {\n  set('fins', 'deflect', 0);\n}";
    const bp = {
      format: 1,
      name: 'x',
      grid: ['K  .  L  .  M', 'D  .  D  .  D', 'F  C  F  F  F'],
      legend: { K: { part: 'core', tags: ['m1'] }, L: { part: 'core', tags: ['m2'] }, M: { part: 'core', tags: ['m3'] } },
      primaryCore: 'core@1,0',
      cores: {
        'core@0,2': { scope: 'm1', scripts: [{ id: 'guide', source: guide }] },
        'core@2,2': { scope: 'm2', scripts: [{ id: 'guide', source: guide }] },
        'core@4,2': { scope: 'm3', scripts: [{ id: 'guide', source: `${guide}\n// its own copy, edited` }] },
      },
    };
    const said = formatIssues(await scriptIssues(bp)).split('\n');
    expect(said).toHaveLength(2);
    expect(said[0]).toMatch(/^warning SCRIPT_TARGET: core core@0,2 \(m1\): script 'guide' line 2: set\('fins', \.\.\.\) reaches nothing: .*\); the same in 1 more copy of this script \(core core@2,2 \(m2\)\)$/);
    // A copy that was edited is its own script.
    expect(said[1]).toMatch(/^warning SCRIPT_TARGET: core core@4,2 \(m3\): script 'guide' line 2: set\('fins', \.\.\.\) reaches nothing: .*\)$/);
  });

  it('does not guess at a target built in code, nor judge the names in a type or tag test', async () => {
    expect(await lines("function tick() { for (const p of parts) if (p.type === 'gun' || p.tags.includes('turret')) set(p.id, 'fire', 1); set('grip' + 1, 'fire', 1); }")).toEqual([]);
  });

  it('reports a channel the target does not have, with the ones it has', async () => {
    expect(await lines("function tick() {\n  set('wheels', 'throttle', 1);\n  get('wheels', 'sped');\n}")).toEqual([
      "warning SCRIPT_CHANNEL: script 'drive' (x.drive.js) line 2: set('wheels', 'throttle') writes an input a wheel does not have (inputs: speed)",
      expect.stringMatching(/^warning SCRIPT_CHANNEL: script 'drive' \(x\.drive\.js\) line 3: get\('wheels', 'sped'\) reads a value a wheel does not have; did you mean 'speed'\? \(inputs: speed; outputs: /),
    ]);
  });

  it('reports a channel no part type has when the target is not plain', async () => {
    expect(await lines("function tick() { for (const p of parts) { set(p.id, 'throtle', 1); set(p.id, 'throttle', 1); } }")).toEqual([
      "warning SCRIPT_CHANNEL: script 'drive' (x.drive.js) line 1: set(..., 'throtle') writes an input no part has; did you mean 'throttle'?",
    ]);
  });

  it("checks another core's scripts and a recipe's, naming them", async () => {
    const bp = {
      format: 1,
      name: 'x',
      grid: ['C  F  K', 'W  .  W'],
      legend: { K: { part: 'core', tags: ['pod'] } },
      cores: { 'core@2,1': { scripts: [{ id: 'guide', source: "function tick() { set('podd', 'angle', 0); }" }] } },
    };
    expect(formatIssues(await scriptIssues(bp))).toMatch(/^warning SCRIPT_TARGET: core core@2,1: script 'guide' line 1: set\('podd', \.\.\.\) reaches nothing/);
  });

  it('says nothing about scripts when the blueprint itself cannot be read', async () => {
    expect(await scriptIssues({ format: 1, name: 'x', grid: ['@'] })).toEqual([]);
  });
});

describe('pnpm sim validate with scripts', () => {
  it('prints script warnings after the blueprint issues and still exits 0', async () => {
    const v = await validateWithScripts(car("function tick() { set('wheelz', 'speed', 1); }"));
    expect(v.ok).toBe(true);
    expect(v.text).toMatch(/^warning SCRIPT_TARGET: /);
    const dir = draftFolder({ 'x.json': { format: 1, name: 'x', grid: ['C  F  F', 'W  .  W'], scripts: [{ id: 'drive', source: { file: 'x.drive.js' } }] }, 'x.drive.js': 'function tick() {\n  set(;\n}' });
    const r = sim('validate', join(dir, 'x.json'));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^warning SCRIPT_SYNTAX: script 'drive' \(x\.drive\.js\) does not compile/);
  });

  it('finds nothing to say about any stock blueprint but names that reach nothing, and those are the known ones', async () => {
    // M16: a plain name that reaches nothing is said. A part type a script drives as one of several (a guide that
    // arms `warhead` and `heavywarhead` alike) is left alone; what is left on the stock robots is tags only some of
    // them carry (`bay`, `dprop`) and a part type a shared script drives alone (`fin`, `swivelthruster`'s
    // `swivel`, a `thruster`). The robots are left as they are; this holds the list of such names still, so a new
    // one is looked at when it appears.
    const noisy: string[] = [];
    const dead = new Set<string>();
    for (const name of listBlueprints()) {
      for (const i of await scriptIssues(loadBlueprintFile(name))) {
        const m = i.code === 'SCRIPT_TARGET' ? /line \d+: (?:set|get)\('([^']+)', \.\.\.\) reaches nothing: /.exec(i.message) : null;
        if (i.severity === 'warning' && m) dead.add(m[1] as string);
        else noisy.push(`${name}: ${formatIssues([i])}`);
      }
    }
    expect(noisy).toEqual([]);
    expect([...dead].sort()).toEqual(['bay', 'dprop', 'fin', 'swivelthruster', 'thruster']);
  }, 120_000);
});
