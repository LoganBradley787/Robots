import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import { moveParts, replacePartType } from '../src/blueprint/edit';
import type { Blueprint } from '../src/blueprint/types';
import { defaultRegistry } from '../src/parts/registry';
import {
  calls,
  deadNames,
  foldScriptIssues,
  namesAvailable,
  partDrivers,
  partsReached,
  partsScriptReaches,
  plainStrings,
  readScript,
  scriptIdMentions,
  scriptNameIssues,
  scriptReach,
  scriptRuns,
  undrivenParts,
} from '../src/script/reading';

const reg = defaultRegistry();

function bp(raw: Record<string, unknown>): Blueprint {
  const r = expandBlueprint({ format: 1, name: 'x', ...raw });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

const src = (...lines: string[]): string => lines.join('\n');

describe('readScript: the names a script uses, with their places', () => {
  it('reads plain set and get targets with the input or output and the spot of each quoted name', () => {
    const code = src('function tick() {', "  set('lprop', 'throttle', 1);", '  const a = get("core", "energy");', '}');
    const r = readScript(code);
    expect(r.names).toEqual([
      { name: 'lprop', use: 'set', line: 2, column: 7, start: 24, end: 31, channel: 'throttle', channelAt: { line: 2, column: 16, start: 33, end: 43 } },
      { name: 'core', use: 'get', line: 3, column: 17, start: 65, end: 71, channel: 'energy', channelAt: { line: 3, column: 25, start: 73, end: 81 } },
    ]);
    // The spot is the quoted text, quotes and all, so a fix can rewrite exactly that.
    expect(code.slice(24, 31)).toBe("'lprop'");
    expect(code.slice(65, 71)).toBe('"core"');
    expect(r.buildsTargets).toBe(false);
    expect(r.built).toEqual([]);
  });

  it('reads a set or get without a plain second argument as a name with no channel', () => {
    expect(readScript("set('bay', name, 1); get('bay')").names.map((n) => [n.name, n.use, n.channel])).toEqual([['bay', 'set', undefined], ['bay', 'get', undefined]]);
  });

  it('reads tag tests, and type and id tests written either way round', () => {
    const r = readScript(
      src(
        "const guns = parts.filter((p) => p.tags.includes('guns') && p.type === 'gun');",
        "const rot = parts.find((p) => p.tags.indexOf('rots') >= 0 && p.id !== 'rotator@1,2');",
        "if ('laser' == p.type || 'core@0,0' === part.id) {}",
        "const motors = parts.filter((p) => ['thruster', 'booster'].includes(p.type));",
      ),
    );
    expect(r.names.map((n) => [n.name, n.use, n.line])).toEqual([
      ['guns', 'tag', 1],
      ['gun', 'type', 1],
      ['rots', 'tag', 2],
      ['rotator@1,2', 'id', 2],
      ['laser', 'type', 3],
      ['core@0,0', 'id', 3],
      ['thruster', 'type', 4],
      ['booster', 'type', 4],
    ]);
    expect(r.buildsTargets).toBe(false);
  });

  it('does not take other comparisons and other lists for names', () => {
    const r = readScript(src("if (mode === 'idle' || c.side === 'enemy') {}", "const order = ['a', 'b'].includes(mode);", "const s = typeof x === 'string';", "if (p.kind.type === 'gun') {}"));
    expect(r.names.map((n) => n.name)).toEqual(['gun']);
  });

  it('flags targets built in code, each with how', () => {
    const r = readScript(src("set('grip' + k, 'fire', 1);", 'set(p.id, "throttle", 1);', 'get(`turret${n}.rot`, "angle");', "set(name, 'turn', 0);", "set(pick('a', 'b'), 'turn', 0);", "set('wheels', 'speed', 1);"));
    expect(r.buildsTargets).toBe(true);
    expect(r.built.map((b) => [b.fn, b.how, b.line, b.column, b.channel])).toEqual([
      ['set', 'concat', 1, 5, 'fire'],
      ['set', 'id', 2, 5, 'throttle'],
      ['get', 'template', 3, 5, 'angle'],
      ['set', 'code', 4, 5, 'turn'],
      ['set', 'code', 5, 5, 'turn'],
    ]);
    expect(r.names.map((n) => n.name)).toEqual(['wheels']);
  });

  it('is not fooled by comments, strings, templates, regexes, methods, or a set of the script\'s own', () => {
    const r = readScript(
      src(
        "// set('a', 'b', 1)",
        "/* p.type === 'gun' */",
        "const s = \"set('a', 'b', 1)\" + `tags.includes('c') ${ok ? `set('c', 'd')` : 1}`;",
        "const re = /set\\('a', 'b'/.test(s) ? map.get('a', 'b') : offset('a', 'b');",
        "state.set('a', 'b'); const half = total / 2; set('wheels', 'speed', half / 2);",
      ),
    );
    expect(r.names.map((n) => [n.name, n.line])).toEqual([['wheels', 5]]);
    expect(readScript("const set = (a, b) => 0;\nset('x', 'y');").names).toEqual([]);
    expect(readScript("set('a\\'b', 'x', 1)").names).toEqual([]);
  });

  it('counts columns in characters from 1, on every line, after tabs and multi-line comments', () => {
    const code = src('/* a', '   b */ set("x", "y", 1);', "\tset('z', 'y', 1);");
    expect(readScript(code).names.map((n) => [n.line, n.column, code.slice(n.start, n.end)])).toEqual([[2, 13, '"x"'], [3, 6, "'z'"]]);
  });

  it('keeps calls() and plainStrings() as the CLI used them', () => {
    expect(calls("set('wheels', 'speed', 1); get(tag, 'angle'); set('grip' + k, name, 1);")).toEqual([
      { fn: 'set', line: 1, target: 'wheels', channel: 'speed' },
      { fn: 'get', line: 1, channel: 'angle' },
      { fn: 'set', line: 1 },
    ]);
    expect([...plainStrings("const a = 'x'; set('y', \"z\", 1); // 'no'")]).toEqual(['x', 'y', 'z']);
  });
});

/** A gun drone: left and right propellers by tag, two tagged turrets, a third gun nobody tagged, a radar. */
const drone = (extra: Record<string, unknown> = {}): Blueprint =>
  bp({
    grid: ['g  .  h  .  n', 'r  .  s  .  F', 'l  F  C  F  p'],
    legend: {
      l: { part: 'propeller', tags: ['lprop'] },
      p: { part: 'propeller', tags: ['rprop'] },
      g: { part: 'gun', tags: ['turret1.gun', 'guns'] },
      h: { part: 'gun', tags: ['turret2.gun', 'guns'] },
      n: { part: 'gun' },
      r: { part: 'rotator', tags: ['turret1.rot'] },
      s: { part: 'rotator', tags: ['turret2.rot'] },
    },
    ...extra,
  });

describe('what names reach', () => {
  it('reaches by tag, by part type, and by id', () => {
    const d = drone();
    expect(partsReached(d, reg, 'guns').map((p) => p.id)).toEqual(['gun@0,2', 'gun@2,2']);
    expect(partsReached(d, reg, 'gun').map((p) => p.id)).toEqual(['gun@0,2', 'gun@2,2', 'gun@4,2']);
    expect(partsReached(d, reg, 'gun@4,2').map((p) => p.id)).toEqual(['gun@4,2']);
    expect(partsReached(d, reg, 'turret1.gun').map((p) => p.id)).toEqual(['gun@0,2']);
    expect(partsReached(d, reg, 'cannon')).toEqual([]);
    expect(namesAvailable(d, reg)).toEqual({ types: ['gun', 'rotator', 'frame', 'propeller', 'core'], tags: ['turret1.gun', 'guns', 'turret2.gun', 'turret1.rot', 'turret2.rot', 'lprop', 'rprop'] });
  });

  it('says for each set and get whether a reached part has the input or output', () => {
    const d = drone();
    const r = scriptReach(readScript("set('guns', 'fire', 1); set('guns', 'throttle', 1); get('guns', 'sight'); set('guns', 'sight', 1); get('turret1.rot', 'angle'); set('lprop', v, 1);"), d, reg);
    expect(r.map((x) => [x.name.name, x.name.channel, x.parts.length, x.channelFound])).toEqual([
      ['guns', 'fire', 2, true],
      ['guns', 'throttle', 2, false],
      // An output can be read, not written.
      ['guns', 'sight', 2, true],
      ['guns', 'sight', 2, false],
      ['turret1.rot', 'angle', 1, true],
      ['lprop', undefined, 1, undefined],
    ]);
    // A group of two types: one of them having the input is enough.
    const mixed = bp({ grid: ['a  b  C'], legend: { a: { part: 'thruster', tags: ['push'] }, b: { part: 'gyro', tags: ['push'] } } });
    expect(scriptReach(readScript("set('push', 'spin', 1); set('push', 'fire', 1);"), mixed, reg).map((x) => x.channelFound)).toEqual([true, false]);
  });

  it('lists the parts a script reaches, in blueprint order, for the board to light up', () => {
    const d = drone();
    expect(partsScriptReaches(readScript("set('rprop', 'throttle', 1); set('lprop', 'throttle', 1); if (p.tags.includes('guns')) {}"), d, reg)).toEqual(['gun@0,2', 'gun@2,2', 'propeller@0,0', 'propeller@4,0']);
  });
});

/** A launcher with two placed missiles, each with its own core, scope and scripts; the launcher's own script on top. */
const launcher = (): Blueprint =>
  bp({
    grid: ['w  .  x', 'K  .  L', 'f  .  g', 't  .  u', 'D  .  E', 'F  C  F'],
    legend: {
      K: { part: 'core', tags: ['missile1'] },
      w: { part: 'warhead', tags: ['missile1', 'missile1.tip'] },
      f: { part: 'fin', tags: ['missile1', 'missile1.fins'] },
      t: { part: 'thruster', rot: 180, tags: ['missile1', 'missile1.burn'] },
      D: { part: 'decoupler', tags: ['rel1'] },
      L: { part: 'core', tags: ['missile2'] },
      x: { part: 'warhead', tags: ['missile2', 'missile2.tip'] },
      g: { part: 'fin', tags: ['missile2', 'missile2.fins'] },
      u: { part: 'thruster', rot: 180, tags: ['missile2', 'missile2.burn'] },
      E: { part: 'decoupler', tags: ['rel2'] },
    },
    primaryCore: 'core@1,0',
    scripts: [{ id: 'fire', source: "function tick() { set('rel1', 'fire', 1); set('missile2.burn', 'throttle', 1); set('fins', 'deflect', 0); }", file: 'x.fire.js' }],
    cores: {
      'core@0,4': { scope: 'missile1', bindings: [{ key: 'x', mode: 'hold', target: 'burn', channel: 'throttle', value: 1 }], scripts: [{ id: 'guide', source: "function tick() {\n  set('burn', 'throttle', 1);\n  set('fins', 'deflect', 0);\n  set('tip', 'arm', 1);\n  set('rel1', 'fire', 1);\n}" }] },
      'core@2,4': { scope: 'missile2', bindings: [], scripts: [{ id: 'guide', source: "function tick() { set('thruster', 'throttle', 1); set('missile2.fins', 'deflect', 0); }" }] },
    },
  });

describe('several cores and scoped tags', () => {
  it('lists every script with the scope it runs under', () => {
    expect(scriptRuns(launcher()).map((r) => [r.script.id, r.scope, r.core, r.label])).toEqual([
      ['fire', undefined, undefined, ''],
      ['guide', 'missile1', 'core@0,4', 'core core@0,4 (missile1): '],
      ['guide', 'missile2', 'core@2,4', 'core core@2,4 (missile2): '],
    ]);
  });

  it('a scoped core sees its own parts by their tags without the scope, and only its own', () => {
    const b = launcher();
    expect(partsReached(b, reg, 'fins', 'missile1').map((p) => p.id)).toEqual(['fin@0,3']);
    expect(partsReached(b, reg, 'fins', 'missile2').map((p) => p.id)).toEqual(['fin@2,3']);
    // The robot's own controls see the tags as written, so a bare `fins` is nothing to them.
    expect(partsReached(b, reg, 'fins')).toEqual([]);
    expect(partsReached(b, reg, 'missile1.fins').map((p) => p.id)).toEqual(['fin@0,3']);
    // A part type and an id reach across scopes; the robot's own tags do not reach into one.
    expect(partsReached(b, reg, 'thruster', 'missile1').map((p) => p.id)).toEqual(['thruster@0,2', 'thruster@2,2']);
    expect(partsReached(b, reg, 'rel1', 'missile1')).toEqual([]);
    expect(namesAvailable(b, reg, 'missile1').tags).toEqual(['tip', 'fins', 'burn']);
  });

  it('judges each script under its own scope', () => {
    const b = launcher();
    const dead = scriptRuns(b).map((r) => deadNames(readScript(r.script.source as string), r.blueprint, reg, r.scope).map((d) => d.name));
    // The launcher's `fins` is no tag of its own; missile1's `rel1` is the launcher's tag, hidden from it; missile2's
    // full `missile2.fins` is not how it sees its own fins.
    expect(dead).toEqual([['fins'], ['rel1'], ['missile2.fins']]);
    const first = deadNames(readScript(b.cores?.[1]?.scripts[0]?.source as string), b, reg, 'missile2')[0];
    // The same tag without the scope is what it meant.
    expect(first?.nearest).toBe('fins');
    expect(first?.available[0]).toBe('fins');
    expect(deadNames(readScript(b.scripts[0]?.source as string), b, reg)[0]).toMatchObject({ name: 'fins', nearest: 'missile1.fins' });
  });
});

describe('deadNames', () => {
  it('finds a name that reaches nothing, with its place and the real names nearest first', () => {
    const d = drone();
    const dead = deadNames(readScript(src('function tick() {', "  set('lprop', 'throttle', 1);", "  if (get('right', 'armed')) set('gunz', 'fire', 1);", '}')), d, reg);
    expect(dead.map((x) => [x.name, x.use, x.line, x.column, x.nearest])).toEqual([['right', 'get', 3, 11, undefined], ['gunz', 'set', 3, 34, 'guns']]);
    expect(dead[1]?.available.slice(0, 2)).toEqual(['guns', 'gun']);
    expect(dead[1]?.available).toHaveLength(12);
  });

  it('counts a part type the robot lacks as dead, and one it has as alive', () => {
    const d = drone();
    expect(deadNames(readScript("set('warhead', 'detonate', 1); set('gun', 'fire', 1); get('core', 'energy');"), d, reg).map((x) => x.name)).toEqual(['warhead']);
  });

  it('a part type the script drives as one of several is spare, not dead; alone, or as a tag, it is dead', () => {
    const d = drone();
    // The drone has guns and no cannon: firing both is "whichever it has".
    const both = readScript("set('gun', 'fire', 1); set('cannon', 'fire', 1); if (get('laser', 'sight') < 5 || get('gun', 'sight') < 5) {}");
    expect(deadNames(both, d, reg)).toEqual([]);
    expect(scriptReach(both, d, reg).map((r) => [r.name.name, r.name.use, r.spare])).toEqual([['gun', 'set', undefined], ['cannon', 'set', true], ['laser', 'get', true], ['gun', 'get', undefined]]);
    // Alone, the type is dead; so is one whose twin writes another input, or only reads where this one writes.
    expect(deadNames(readScript("set('cannon', 'fire', 1);"), d, reg).map((x) => x.name)).toEqual(['cannon']);
    expect(deadNames(readScript("set('lprop', 'throttle', 1); set('cannon', 'fire', 1);"), d, reg).map((x) => x.name)).toEqual(['cannon']);
    expect(deadNames(readScript("get('gun', 'fire'); set('cannon', 'fire', 1);"), d, reg).map((x) => x.name)).toEqual(['cannon']);
    // The twin must reach a part that has the input: `guns` has no `throttle`, so nothing takes this call at all.
    expect(deadNames(readScript("set('guns', 'throttle', 1); set('thruster', 'throttle', 1);"), d, reg).map((x) => x.name)).toEqual(['thruster']);
    // A group works as the twin; a dead tag never is spare, whatever sits beside it.
    expect(deadNames(readScript("set('guns', 'fire', 1); set('cannon', 'fire', 1); set('gunz', 'fire', 1);"), d, reg).map((x) => x.name)).toEqual(['gunz']);
    // Two absent types do not vouch for each other.
    expect(deadNames(readScript("set('warhead', 'arm', 1); set('heavywarhead', 'arm', 1);"), d, reg).map((x) => x.name)).toEqual(['warhead', 'heavywarhead']);
  });

  it('offers part ids only for a name that looks like one', () => {
    const d = drone();
    const dead = deadNames(readScript("set('gun@0,3', 'fire', 1)"), d, reg)[0];
    expect(dead?.nearest).toBe('gun@0,2');
    expect(dead?.available[0]).toBe('gun@0,2');
  });

  it('does not judge names in type and id tests, nor targets built in code; tag tests only when asked', () => {
    const d = drone();
    const reading = readScript("if (p.type === 'heavywarhead' || p.id === 'nope@1,1' || p.tags.includes('stab')) set('part' + k, 'fire', 1); set(p.id, 'fire', 1);");
    expect(deadNames(reading, d, reg)).toEqual([]);
    expect(deadNames(reading, d, reg, undefined, ['set', 'get', 'tag', 'type', 'id']).map((x) => [x.name, x.use])).toEqual([['stab', 'tag']]);
  });

  it('leaves alone what a bay builds: its copies by name, and the part types of its recipe', () => {
    const b = bp({
      grid: ['.  =  .  =  .', '.  =  .  =  .', '.  =  b  =  .', 'C  F  F  F  .'],
      legend: { b: { part: 'fabbay', tags: ['bay'], makes: 'pod', size: [1, 2] } },
      recipes: { pod: { format: 1, name: 'pod', grid: ['w', 'C'], legend: { w: { part: 'warhead', tags: ['tip'] } }, scripts: [{ id: 'go', source: "function tick() { set('tip', 'arm', 1); set('bay', 'release', 1); }" }] } },
    });
    const reading = readScript("set('bay1', 'x', 1); set('bay12.tip', 'arm', 1); set('warhead', 'arm', 1); set('warhead', 'fire', 1); set('bayx', 'y', 1); set('tip', 'arm', 1); set('gun', 'fire', 1);");
    expect(deadNames(reading, b, reg).map((x) => x.name)).toEqual(['bayx', 'tip', 'gun']);
    const reach = scriptReach(reading, b, reg);
    expect(reach.map((r) => [r.name.name, r.atRunTime, r.channelFound])).toEqual([
      ['bay1', true, undefined],
      ['bay12.tip', true, undefined],
      ['warhead', true, true],
      ['warhead', true, false],
      ['bayx', false, undefined],
      ['tip', false, undefined],
      ['gun', false, undefined],
    ]);
    // The recipe's own script runs on the recipe's parts: its `tip` is there, the mothership's `bay` is not.
    const inner = scriptRuns(b)[0];
    expect(inner?.recipes).toEqual(['pod']);
    expect(inner?.label).toBe('recipe pod: ');
    expect(deadNames(readScript(inner?.script.source as string), inner?.blueprint as Blueprint, reg, inner?.scope).map((x) => x.name)).toEqual(['bay']);
  });
});

describe('undrivenParts: parts that look like they belong', () => {
  const turrets = "function tick() { set('guns', 'fire', 1); set('turret1.rot', 'turn', 0); set('lprop', 'throttle', 1); set('rprop', 'throttle', 1); }";

  it('finds a part of a driven type that is in none of the script\'s groups, with the group to add it to', () => {
    expect(undrivenParts(readScript(turrets), drone(), reg)).toEqual([
      { part: 'gun@4,2', type: 'gun', inputs: ['fire'], groups: [{ name: 'guns', tag: 'guns' }] },
      { part: 'rotator@2,1', type: 'rotator', inputs: ['turn'], groups: [{ name: 'turret1.rot', tag: 'turret1.rot' }] },
    ]);
  });

  it('is the "add one more gun" case: a copy made with its tags is driven, a plain new part is not', () => {
    const d = drone();
    const withTag = { ...d, parts: d.parts.map((p) => (p.id === 'gun@4,2' ? { ...p, tags: ['guns', p.id] } : p)) };
    expect(undrivenParts(readScript("function tick() { set('guns', 'fire', 1); }"), withTag, reg)).toEqual([]);
    expect(undrivenParts(readScript("function tick() { set('guns', 'fire', 1); }"), d, reg).map((u) => u.part)).toEqual(['gun@4,2']);
  });

  it('says nothing when the script builds targets in code', () => {
    expect(undrivenParts(readScript(`${turrets}\nfunction aim() { for (const p of parts) if (p.type === 'gun') set(p.id, 'fire', 1); }`), drone(), reg)).toEqual([]);
    expect(undrivenParts(readScript("set('guns', 'fire', 1); set('turret' + n + '.gun', 'fire', 1);"), drone(), reg)).toEqual([]);
  });

  it('says nothing for a type the script names, as a target or in a test', () => {
    expect(undrivenParts(readScript("set('guns', 'fire', 1); set('gun', 'fire', 0);"), drone(), reg)).toEqual([]);
    expect(undrivenParts(readScript("set('guns', 'fire', 1); const n = parts.filter((p) => p.type === 'gun').length;"), drone(), reg)).toEqual([]);
  });

  it('says nothing for a part the script reaches another way, a part that lacks the input, or a type it only reads', () => {
    const d = drone();
    // The third gun is named by id.
    expect(undrivenParts(readScript("set('guns', 'fire', 1); set('gun@4,2', 'fire', 1);"), d, reg)).toEqual([]);
    // Reads are not driving: nothing to add a part to.
    expect(undrivenParts(readScript("const s = get('guns', 'sight');"), d, reg)).toEqual([]);
    // An input the type does not have is not written on it.
    expect(undrivenParts(readScript("set('guns', 'throttle', 1);"), d, reg)).toEqual([]);
  });

  it('leaves another core\'s parts alone, and under a scope looks only at that scope\'s parts', () => {
    const b = launcher();
    // The launcher drives missile2's thruster by its full tag; missile1's thruster is missile1's own.
    expect(undrivenParts(readScript("set('missile2.burn', 'throttle', 1);"), b, reg)).toEqual([]);
    // A fin placed by hand into missile1 without the `fins` tag: its guide does not drive it.
    const fin = { id: 'fin@1,3', part: 'fin', x: 1, y: 3, rot: 0 as const, tags: ['missile1', 'fin@1,3'] };
    const more = { ...b, parts: [...b.parts, fin] };
    expect(undrivenParts(readScript("set('fins', 'deflect', 0);"), more, reg, 'missile1')).toEqual([{ part: 'fin@1,3', type: 'fin', inputs: ['deflect'], groups: [{ name: 'fins', tag: 'missile1.fins' }] }]);
    expect(undrivenParts(readScript("set('fins', 'deflect', 0);"), more, reg, 'missile2')).toEqual([]);
  });
});

describe('partDrivers: what drives one part, before a swap', () => {
  const car = (source: string): Blueprint =>
    bp({
      grid: ['t  C  t'],
      legend: { t: { part: 'thruster', rot: 90, tags: ['jets'] } },
      bindings: [
        { key: 'j', mode: 'hold', target: 'thruster', channel: 'throttle', value: 1 },
        { key: 'k', mode: 'hold', target: 'jets', channel: 'throttle', value: 1 },
        { key: 'l', mode: 'hold', target: 'thruster@0,0', channel: 'throttle', value: 1 },
        { key: 'm', mode: 'hold', target: 'thruster@2,0', channel: 'throttle', value: 1 },
        { key: 'h', mode: 'script', script: 'drive' },
      ],
      scripts: [{ id: 'drive', source }],
    });

  it('lists the bindings and script names that reach the part, and says whether any is by type', () => {
    const b = car("function tick() {\n  set('thruster', 'throttle', 1);\n  set('jets', 'throttle', 0.5);\n  const n = parts.filter((p) => p.type === 'thruster').length;\n}");
    const d = partDrivers(b, reg, 'thruster@0,0');
    expect(d.drivers.map((x) => [x.kind, x.via, x.name, x.key ?? x.script, x.channel, x.at?.line])).toEqual([
      ['binding', 'type', 'thruster', 'j', 'throttle', undefined],
      ['binding', 'tag', 'jets', 'k', 'throttle', undefined],
      ['binding', 'id', 'thruster@0,0', 'l', 'throttle', undefined],
      ['set', 'type', 'thruster', 'drive', 'throttle', 2],
      ['set', 'tag', 'jets', 'drive', 'throttle', 3],
      ['test', 'type', 'thruster', 'drive', undefined, 4],
    ]);
    expect(d.byType).toBe(true);
    expect(d.typeTests.map((x) => x.at?.line)).toEqual([4]);
    expect(d.buildsTargets).toEqual([]);
    expect(d.missing).toEqual([]);
  });

  it('says which inputs the drivers use that a new type lacks', () => {
    const b = car("function tick() { set('jets', 'throttle', 1); set('jets', 'swivel', 0); get('jets', 'angle'); }");
    // A swivel thruster has both inputs; a booster has no swivel; a gun has neither.
    expect(partDrivers(b, reg, 'thruster@0,0', 'swivelthruster').missing.map((x) => [x.kind, x.channel])).toEqual([['get', 'angle']]);
    expect(partDrivers(b, reg, 'thruster@0,0', 'booster').missing.map((x) => [x.kind, x.channel])).toEqual([['set', 'swivel'], ['get', 'angle']]);
    expect(partDrivers(b, reg, 'thruster@0,0', 'gun').missing.map((x) => [x.kind, x.name, x.channel])).toEqual([
      ['binding', 'thruster', 'throttle'],
      ['binding', 'jets', 'throttle'],
      ['binding', 'thruster@0,0', 'throttle'],
      ['set', 'jets', 'throttle'],
      ['set', 'jets', 'swivel'],
      ['get', 'jets', 'angle'],
    ]);
  });

  it('is not by type when only a tag, an id, or a test names it, and notes a script that builds targets', () => {
    const b = { ...car("function tick() { for (const p of parts) if (p.type === 'thruster') set(p.id, 'throttle', 1); }"), bindings: [] };
    const d = partDrivers(b, reg, 'thruster@2,0');
    expect(d.byType).toBe(false);
    expect(d.typeTests).toHaveLength(1);
    expect(d.buildsTargets).toEqual([{ script: 'drive', label: '' }]);
    expect(partDrivers(b, reg, 'nothing@9,9')).toEqual({ drivers: [], byType: false, typeTests: [], buildsTargets: [], missing: [] });
  });

  it('with keepTypeTag a swapped part is still reached by the old type name; without it, not', () => {
    const b = car("function tick() { set('thruster', 'throttle', 1); }");
    const plain = replacePartType(b, reg, 'thruster@0,0', 'booster');
    const kept = replacePartType(b, reg, 'thruster@0,0', 'booster', { keepTypeTag: true });
    if (!plain.ok || !kept.ok) throw new Error('swap refused');
    expect(partDrivers(plain.blueprint, reg, 'booster@0,0').drivers.map((x) => x.name)).toEqual(['jets', 'booster@0,0']);
    const d = partDrivers(kept.blueprint, reg, 'booster@0,0');
    expect(d.drivers.map((x) => [x.kind, x.via, x.name])).toEqual([['binding', 'tag', 'thruster'], ['binding', 'tag', 'jets'], ['binding', 'id', 'booster@0,0'], ['set', 'tag', 'thruster']]);
  });

  it('reads each core\'s controls under that core\'s scope', () => {
    const b = launcher();
    expect(partDrivers(b, reg, 'thruster@0,2').drivers.map((x) => [x.label, x.kind, x.via, x.name])).toEqual([
      ['core core@0,4 (missile1): ', 'binding', 'tag', 'burn'],
      ['core core@0,4 (missile1): ', 'set', 'tag', 'burn'],
      ['core core@2,4 (missile2): ', 'set', 'type', 'thruster'],
    ]);
  });
});

describe('scriptIdMentions: scripts that spell a part id', () => {
  it('finds the old id of a moved part in script code, with its place', () => {
    const b = drone({ scripts: [{ id: 'aim', source: "function tick() {\n  set('gun@4,2', 'fire', 1);\n  const g = parts.find((p) => p.id === 'gun@4,2');\n}" }] });
    const r = moveParts(b, reg, ['gun@4,2'], 0, 1);
    if (!r.ok) throw new Error(r.error);
    const found = scriptIdMentions(r.blueprint, [...r.ids.keys()]);
    expect(found.map((m) => [m.script, m.label, m.id, m.line, m.column])).toEqual([['aim', '', 'gun@4,2', 2, 7], ['aim', '', 'gun@4,2', 3, 40]]);
    const code = r.blueprint.scripts[0]?.source as string;
    expect(found.map((m) => code.slice(m.start, m.end))).toEqual(["'gun@4,2'", "'gun@4,2'"]);
    expect(scriptIdMentions(r.blueprint, ['gun@0,2'])).toEqual([]);
  });
});

describe('scriptNameIssues: the shared check', () => {
  const issues = (b: Blueprint): string[] => scriptRuns(b).flatMap((r) => scriptNameIssues(r, reg).map((i) => `${i.severity} ${i.code}: ${i.message}`));

  it('warns for a dead name with the script, the line, and the real names', () => {
    const b = drone({ scripts: [{ id: 'fire', file: 'x.fire.js', source: "function tick() {\n  set('lprop', 'throttle', 1);\n  if (get('right', 'armed')) set('gunz', 'fire', 1);\n}" }] });
    expect(issues(b)).toEqual([
      expect.stringMatching(/^warning SCRIPT_TARGET: script 'fire' \(x\.fire\.js\) line 3: get\('right', \.\.\.\) reaches nothing: no part has that tag, part type, or id \(tags here: rprop, .*; part types here: .*\)$/),
      "warning SCRIPT_TARGET: script 'fire' (x.fire.js) line 3: set('gunz', ...) reaches nothing: no part has that tag, part type, or id; did you mean 'guns'? (tags here: guns, lprop, rprop, turret1.gun, turret2.gun, turret1.rot, turret2.rot; part types here: gun, core, frame, rotator, propeller)",
    ]);
  });

  it('warns for a part type the robot lacks', () => {
    const b = drone({ scripts: [{ id: 'boom', source: "function tick() { set('warhead', 'detonate', 1); }" }] });
    expect(issues(b)).toEqual([expect.stringMatching(/^warning SCRIPT_TARGET: script 'boom' line 1: set\('warhead', \.\.\.\) reaches nothing: no part has that tag, part type, or id \(tags here: /)]);
  });

  it('warns for an input the reached parts lack, and for one no part has when the target is built in code', () => {
    const b = drone({ scripts: [{ id: 's', source: "function tick() {\n  set('guns', 'throttle', 1);\n  set(p.id, 'throtle', 1);\n  set(p.id, 'throttle', 1);\n}" }] });
    expect(issues(b)).toEqual([
      "warning SCRIPT_CHANNEL: script 's' line 2: set('guns', 'throttle') writes an input a gun does not have (inputs: fire)",
      "warning SCRIPT_CHANNEL: script 's' line 3: set(..., 'throtle') writes an input no part has; did you mean 'throttle'?",
    ]);
  });

  it('names the core and the scope, and judges under it', () => {
    expect(issues(launcher())).toEqual([
      expect.stringMatching(/^warning SCRIPT_TARGET: script 'fire' \(x\.fire\.js\) line 1: set\('fins', \.\.\.\) reaches nothing: no part has that tag, part type, or id; did you mean 'missile1\.fins'\? \(tags here: missile1\.fins, missile2\.fins/),
      expect.stringMatching(/^warning SCRIPT_TARGET: core core@0,4 \(missile1\): script 'guide' line 5: set\('rel1', \.\.\.\) reaches nothing.*\(tags here: tip, fins, burn; part types here: /),
      expect.stringMatching(/^warning SCRIPT_TARGET: core core@2,4 \(missile2\): script 'guide' line 1: set\('missile2\.fins', \.\.\.\) reaches nothing/),
    ]);
  });

  it('gives each issue its script and its text without the script\'s name, and folds what copies share', () => {
    const b = launcher();
    const code = "function tick() {\n  set('nothing', 'x', 1);\n}";
    const cores = (b.cores ?? []).map((c) => ({ ...c, scripts: [{ id: 'guide', enabled: true, params: {}, source: code }] }));
    const same = { ...b, scripts: [], cores };
    const all = scriptRuns(same).flatMap((r) => scriptNameIssues(r, reg));
    expect(all.map((i) => [i.run.core, i.run.scope, i.code])).toEqual([['core@0,4', 'missile1', 'SCRIPT_TARGET'], ['core@2,4', 'missile2', 'SCRIPT_TARGET']]);
    expect(all[0]?.message).toBe(`core core@0,4 (missile1): script 'guide' ${all[0]?.body}`);
    expect(all[0]?.body).toBe(all[1]?.body);
    const folded = foldScriptIssues(all);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.runs.map((r) => r.core)).toEqual(['core@0,4', 'core@2,4']);
    expect(folded[0]?.message).toBe(`${all[0]?.message}; the same in 1 more copy of this script (core core@2,4 (missile2))`);
    expect(folded[0]).toMatchObject({ severity: 'warning', code: 'SCRIPT_TARGET', body: all[0]?.body });
    // Different code, or a different problem, is not folded; one issue alone is left as it is.
    const other = { ...same, cores: cores.map((c, i) => (i === 1 ? { ...c, scripts: [{ ...c.scripts[0], id: 'guide', enabled: true, params: {}, source: `${code}\n` }] } : c)) };
    const apart = foldScriptIssues(scriptRuns(other).flatMap((r) => scriptNameIssues(r, reg)));
    expect(apart.map((f) => [f.runs.length, f.message.includes('the same in')])).toEqual([[1, false], [1, false]]);
    // More than three other copies are counted, not all named.
    const many = Array.from({ length: 6 }, (_, i) => ({ ...(all[0] as (typeof all)[number]), run: { ...(all[0] as (typeof all)[number]).run, label: `core c${i}: `, core: `c${i}` } }));
    expect(foldScriptIssues(many)[0]?.message).toMatch(/; the same in 5 more copies of this script \(core c1, core c2, core c3, and 2 more\)$/);
  });

  it('says nothing for a script that was not loaded from its file', () => {
    const b = drone({ scripts: [{ id: 's', source: { file: 'x.s.js' } }] });
    expect(issues(b)).toEqual([]);
  });
});
