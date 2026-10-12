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

  it('reports a target no part answers to, with its line and the nearest name', async () => {
    expect(await lines("function tick() {\n\n  set('wheelz', 'speed', 1);\n}")).toEqual([
      "warning SCRIPT_TARGET: script 'drive' (x.drive.js) line 3: set('wheelz', ...) reaches nothing: no part has that tag, part type, or id; did you mean 'wheels'?",
    ]);
  });

  it('leaves a name the robot lacks alone unless it is nearly one it has and the script does not use', async () => {
    // Stock scripts are shared between robots: a tag only some carry (`dprop` beside `lprop`), or a part type.
    expect(await lines("function tick() { set('wheels', 'speed', 1); set('wheelz', 'speed', 1); if (get('bay', 'ready') > 0) set('bay', 'release', 1); set('gun', 'fire', 1); }")).toEqual([]);
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

  it('finds nothing to say about any stock blueprint', async () => {
    const noisy: string[] = [];
    for (const name of listBlueprints()) {
      const issues = await scriptIssues(loadBlueprintFile(name));
      if (issues.length > 0) noisy.push(`${name}: ${formatIssues(issues)}`);
    }
    expect(noisy).toEqual([]);
  }, 120_000);
});
