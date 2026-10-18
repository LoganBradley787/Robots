import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { codeHistory, outsideChanges } from '../src/ui/codeEditor';
import { defaultRegistry, loadBlueprint, type Blueprint } from '@robots/sim-core';
import { allTargets, completeAt, editorChecks, placeFix } from '../src/builder/scriptAssist';
import { apiDim, apiSections, robotReference, SCRIPT_API } from '../src/builder/scriptRef';
import { partNameInsert } from '../src/ui/ScriptEditor';
import { scriptViewWidth } from '../src/ui/layout';

const registry = defaultRegistry();
const bp = (raw: Record<string, unknown>): Blueprint => loadBlueprint({ format: 1, name: 't', ...raw }, registry).blueprint;

/** Two propellers in the group `lift`, a gyro, a battery. Nothing that sees, one core. */
const flyer = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'frame', x: -1, y: 0 },
    { part: 'frame', x: 1, y: 0 },
    { part: 'battery', x: 0, y: -1 },
    { part: 'propeller', x: -2, y: 0, tags: ['lift'] },
    { part: 'propeller', x: 2, y: 0, tags: ['lift'] },
    { part: 'gyro', x: -1, y: -1 },
  ],
});
/** The same with a radar, and a gun on a rotator in the group `turret`. */
const armed = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'frame', x: -1, y: 0 },
    { part: 'frame', x: 1, y: 0 },
    { part: 'propeller', x: -2, y: 0, tags: ['lift'] },
    { part: 'propeller', x: 2, y: 0, tags: ['lift'] },
    { part: 'radar', x: 1, y: -1 },
    { part: 'rotator', x: 0, y: 1, tags: ['turret'] },
    { part: 'gun', x: 0, y: 2, tags: ['turret'] },
  ],
});

describe('This robot', () => {
  const ref = robotReference(flyer, registry);

  it('lists every group, kind and single part that takes or reports something, groups first', () => {
    expect(ref.groups.map((t) => t.name)).toEqual(['lift']);
    // A frame takes and reports nothing, so it is not listed.
    expect(ref.kinds.map((t) => `${t.name}:${t.label}`)).toEqual(['core:Core', 'battery:Battery', 'propeller:Propeller', 'gyro:Gyro']);
    expect(ref.parts.map((t) => t.name)).toEqual(['core@0,0', 'battery@0,-1', 'propeller@-2,0', 'propeller@2,0', 'gyro@-1,-1']);
    expect(ref.groups[0]).toMatchObject({ kind: 'group', count: 2, what: '2 propellers', ids: ['propeller@-2,0', 'propeller@2,0'] });
    expect(ref.parts[2]?.what).toBe('Propeller at -2, 0');
  });

  it('each input has its range in plain words and the call a click writes, with the caret where the value goes', () => {
    expect(ref.groups[0]?.inputs).toEqual([{ name: 'throttle', range: '0 to 1', words: 'off to full', insert: 'set("lift", "throttle", )', caret: 1 }]);
    const gyro = ref.kinds.find((t) => t.name === 'gyro');
    expect(gyro?.inputs.map((c) => `${c.name}: ${c.range}, ${c.words}`)).toEqual(['spin: -1 to 1, full one way to full the other, 0 rests', 'damp: 0 to 1, off to full']);
    expect(ref.kinds.find((t) => t.name === 'battery')?.outputs).toEqual([{ name: 'charge', range: '0 to 1', words: 'none to all', insert: 'get("battery", "charge")', caret: 0 }]);
  });

  it('a group of mixed parts lists every input, with how many parts have it', () => {
    const mixed = robotReference(armed, registry).groups.find((t) => t.name === 'turret');
    expect(mixed?.what).toBe('2 parts');
    expect(mixed?.inputs.map((c) => [c.name, c.on])).toEqual([
      ['turn', 1],
      ['fire', 1],
    ]);
    expect(mixed?.outputs.map((c) => c.name)).toEqual(expect.arrayContaining(['angle', 'sight', 'sightSide', 'aim']));
  });

  it('a placed copy with its own core is described through its own scope', () => {
    const carrier = bp({
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'radar', x: 0, y: 1 },
        { part: 'core', x: 1, y: 0, tags: ['m1'] },
        { part: 'thruster', x: 1, y: -1, tags: ['m1', 'm1.push'] },
      ],
      cores: { 'core@1,0': { scope: 'm1', bindings: [], scripts: [] } },
    });
    const own = robotReference(carrier, registry, 'core@1,0');
    expect(own.scope).toBe('m1');
    expect(own.groups.map((t) => t.name)).toEqual(['push']);
    expect(own.parts.map((t) => t.name)).toEqual(['core@1,0', 'thruster@1,-1']);
    // The radar is the carrier's: the missile's own core sees nothing.
    expect(own.sees).toBe(false);
    expect(robotReference(carrier, registry).sees).toBe(true);
    expect(robotReference(carrier, registry).others).toBe(true);
  });
});

describe('You can use', () => {
  it('is one table, with the facts that trip people up in it', () => {
    const names = SCRIPT_API.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const want of ['self.pos', 'set', 'get', 'parts', 'part.spec', 'part.rot', 'part.on', 'contacts', 'scan', 'keys.down', 'send', 'inbox', 'param', 'state', 'log', 'mark', 'random', 'clamp', 'lerp', 'sign']) expect(names).toContain(want);
    expect(SCRIPT_API.find((e) => e.name === 'get')?.more).toMatch(/FIRST matching part/);
    expect(SCRIPT_API.find((e) => e.name === 'contacts')?.more).toMatch(/NO distance output/);
    for (const e of SCRIPT_API) expect(e.about.length).toBeLessThan(70);
  });

  it('dims what the robot cannot use, with the reason, decided from the part definitions', () => {
    const blind = robotReference(flyer, registry);
    const contacts = SCRIPT_API.find((e) => e.name === 'contacts');
    const send = SCRIPT_API.find((e) => e.name === 'send');
    const set = SCRIPT_API.find((e) => e.name === 'set');
    if (!contacts || !send || !set) throw new Error('the table lost an entry');
    expect(apiDim(contacts, blind, registry)).toBe('nothing on this robot sees: add a part that does, such as a radar');
    expect(apiDim(send, blind, registry)).toBe('this robot has one core and builds nothing, so there is nobody to send to');
    expect(apiDim(set, blind, registry)).toBeUndefined();
    expect(apiSections(blind, registry).filter((s) => s.dim !== undefined).map((s) => s.section)).toEqual(['Seeing', 'Messages']);
    const seeing = robotReference(armed, registry);
    expect(apiDim(contacts, seeing, registry)).toBeUndefined();
    expect(apiSections(seeing, registry).filter((s) => s.dim !== undefined).map((s) => s.section)).toEqual(['Messages']);
    expect(apiSections(blind, registry).map((s) => s.section)).toEqual(['The robot', 'Parts', 'Seeing', 'Keys', 'Messages', 'Settings and memory', 'Maths']);
  });
});

describe('completion', () => {
  const ref = robotReference(armed, registry);
  const at = (text: string, marker = '|') => {
    const pos = text.indexOf(marker);
    return completeAt(text.replace(marker, ''), pos, ref, registry);
  };

  it('inside set(" it offers this robot\'s real names: groups, then kinds, then single parts', () => {
    const r = at('function tick() { set("|") }');
    expect(r?.where).toBe('name');
    expect(r?.options.map((o) => `${o.kind} ${o.label}`)).toEqual(['group lift', 'group turret', 'kind propeller', 'kind radar', 'kind rotator', 'kind gun', 'part propeller@-2,0', 'part propeller@2,0', 'part radar@1,-1', 'part rotator@0,1', 'part gun@0,2']);
    expect(r?.options[0]).toMatchObject({ detail: 'group, 2 propellers', info: 'inputs: throttle', rank: 0 });
    // Parts with nothing to write are not offered to set; get also takes what only reports.
    expect(r?.options.map((o) => o.label)).not.toContain('core');
    expect(at(`get('|`)?.options.map((o) => o.label)).toContain('core');
  });

  it('replaces the whole name being typed, up to its closing quote', () => {
    const text = 'set("lif|xyz", "throttle", 1)';
    const r = at(text);
    expect(r?.from).toBe(5);
    expect(r?.to).toBe('set("lifxyz'.length);
  });

  it('after the name it offers that name\'s real inputs, and for get what it reports too', () => {
    expect(at('set("lift", "|')?.options).toEqual([{ label: 'throttle', detail: 'input, 0 to 1: off to full', rank: 0, kind: 'input' }]);
    expect(at('set("turret", "t|')?.options.map((o) => o.label)).toEqual(['turn', 'fire']);
    const read = at(`get('gun', '|`);
    expect(read?.where).toBe('channel');
    expect(read?.options.map((o) => `${o.kind} ${o.label}`)).toEqual(['input fire', 'output sight', 'output sightSide', 'output sightId', 'output aim']);
    // A name that is not on the robot (yet): every input a part here has.
    expect(at('set("nope", "|')?.options.map((o) => o.label)).toEqual(['throttle', 'turn', 'fire', 'on']);
  });

  it('after self. and keys. it offers their members', () => {
    expect(at('const y = self.|')?.options.map((o) => o.label)).toEqual(['pos', 'vel', 'angle', 'angVel', 'mass', 'energy']);
    expect(at('const y = self.pos.|')?.options.map((o) => o.label)).toEqual(['x', 'y']);
    expect(at('if (keys.d|')?.options.map((o) => o.label)).toEqual(['down', 'pressed', 'released']);
    expect(at('if (keys.d|')).toMatchObject({ where: 'member', from: 9 });
  });

  it('a bare word gets the API names, dimmed where the robot cannot use them; a property, a string or a comment gets nothing', () => {
    const r = completeAt('con', 3, robotReference(flyer, registry), registry);
    expect(r?.where).toBe('word');
    const labels = r?.options.map((o) => o.label) ?? [];
    for (const want of ['self', 'set', 'get', 'parts', 'contacts', 'scan', 'keys', 'send', 'param', 'state', 'log', 'clamp', 'tick', 'setup']) expect(labels).toContain(want);
    expect(labels).not.toContain('part');
    expect(new Set(labels).size).toBe(labels.length);
    expect(r?.options.find((o) => o.label === 'contacts')?.dim).toMatch(/^nothing on this robot sees/);
    expect(at('con|')?.options.find((o) => o.label === 'contacts')?.dim).toBeUndefined();
    expect(at('foo.con|')).toBeUndefined();
    expect(at('log("con|")')).toBeUndefined();
    expect(completeAt('// con', 6, ref, registry, true)).toBeUndefined();
  });

  it('allTargets is the list completion and the reference share', () => {
    expect(allTargets(ref).map((t) => t.name).slice(0, 3)).toEqual(['lift', 'turret', 'core']);
  });
});

describe('checks in the script view', () => {
  const ok = { ok: true as const };
  it('none for a clean script', () => {
    expect(editorChecks(`function tick() { set('lift', 'throttle', 1); }`, flyer, registry, undefined, ok)).toEqual([]);
  });

  it('a syntax error from the sandbox marks its line, first', () => {
    const source = `function tick() {\n  set('lfit', 'throttle', 1)\n  let = ;\n}`;
    const found = editorChecks(source, flyer, registry, undefined, { ok: false, error: { kind: 'compile', message: 'SyntaxError: unexpected token (line 3)' } });
    expect(found.map((c) => `${c.severity} ${c.kind} ${c.line}`)).toEqual(['error syntax 3', 'warning target 2']);
    expect(found[0]?.message).toBe('This does not run: SyntaxError: unexpected token.');
    expect(source.slice(found[0]?.from, found[0]?.to)).toBe('  let = ;');
  });

  it('a dead name carries the real names as one-click fixes that keep its quotes', () => {
    const source = `function tick() { set("lfit", 'throttle', 1); }`;
    const [c] = editorChecks(source, flyer, registry, undefined, ok);
    expect(c).toMatchObject({ kind: 'target', severity: 'warning', line: 1 });
    expect(source.slice(c?.from, c?.to)).toBe('"lfit"');
    expect(c?.fixes.slice(0, 2)).toEqual([
      { label: 'lift', text: '"lift"' },
      { label: 'core', text: '"core"' },
    ]);
    expect(c?.message).toMatch(/^No part answers to 'lfit'\. Did you mean 'lift'\?/);
  });

  it('an unknown input and an unknown output', () => {
    const source = `function tick() { set('lift', 'throtle', 1); get('battery', 'level'); }`;
    const found = editorChecks(source, flyer, registry, undefined, ok);
    expect(found.map((c) => c.kind)).toEqual(['input', 'input']);
    expect(found[0]?.fixes).toEqual([{ label: 'throttle', text: "'throttle'" }]);
    expect(found[1]?.message).toBe("'level' is not something a battery takes or reports. It has: charge.");
  });

  it('a fix clicked after the text changed goes where its problem is now, and nowhere once it is gone (review fixes)', () => {
    const source = `function tick() { set('lift', 'throtle', 1); }`;
    const recheck = (t: string) => editorChecks(t, flyer, registry, undefined, ok);
    const [c] = recheck(source);
    if (!c) throw new Error('no check');
    const put = (text: string, ch: { from: number; to: number; insert: string }): string => text.slice(0, ch.from) + ch.insert + text.slice(ch.to);
    const first = placeFix(c, 'throttle', source, source, recheck);
    if (!first) throw new Error('no fix');
    const fixed = put(source, first);
    expect(fixed).toBe(`function tick() { set('lift', 'throttle', 1); }`);
    // The second click of a double click, with the list not yet worked out again: nothing, not set('lift', 'throttle'', 1).
    expect(placeFix(c, 'throttle', source, fixed, recheck)).toBeUndefined();
    // A line typed above it since: the fix still lands on the name.
    const moved = `// note\n${source}`;
    const again = placeFix(c, 'throttle', source, moved, recheck);
    expect(again && put(moved, again)).toBe(`// note\nfunction tick() { set('lift', 'throttle', 1); }`);
  });

  it('contacts with nothing that sees, and no tick()', () => {
    const found = editorChecks(`function setup() { state.n = contacts.length; }`, flyer, registry, undefined, { ok: false, error: { kind: 'compile', message: 'x.js does not define function tick()' } });
    expect(found.map((c) => c.kind)).toEqual(['tick', 'sees']);
    expect(found.every((c) => c.severity === 'warning')).toBe(true);
    expect(found[0]?.message).toMatch(/^There is no function tick\(\)/);
    expect(editorChecks(`function tick() { state.n = contacts.length; }`, armed, registry, undefined, ok)).toEqual([]);
  });

  it('a script that throws as it starts is an error too', () => {
    const [c] = editorChecks(`nope();\nfunction tick() {}`, flyer, registry, undefined, { ok: false, error: { kind: 'throw', message: "ReferenceError: 'nope' is not defined (line 1)" } });
    expect(c).toMatchObject({ severity: 'error', kind: 'syntax', line: 1, message: "It stops as it starts: ReferenceError: 'nope' is not defined." });
  });
});

describe('small things of the script view', () => {
  it('a part clicked on the board goes in as a quoted name, or bare between quotes already there', () => {
    expect(partNameInsert('set(', 4, 'gun@0,2')).toBe('"gun@0,2"');
    expect(partNameInsert('set("")', 5, 'gun@0,2')).toBe('gun@0,2');
    expect(partNameInsert("set('')", 5, 'gun@0,2')).toBe('gun@0,2');
    expect(partNameInsert('set("a", ', 9, 'gun@0,2')).toBe('"gun@0,2"');
  });

  it('leaves a strip of board beside the inspector at laptop sizes', () => {
    for (const w of [1280, 1366, 1440, 1920]) {
      const board = w - 312 - scriptViewWidth(w);
      expect(board).toBeGreaterThanOrEqual(280);
      expect(scriptViewWidth(w)).toBeGreaterThanOrEqual(670);
    }
    expect(scriptViewWidth(1366)).toBe(738);
    expect(scriptViewWidth(1440)).toBe(790);
  });
});

describe('the code editor and the board share one undo (review fixes)', () => {
  it("after text is set from outside, the editor's own undo brings back none of what the board's Undo took away", () => {
    let state = EditorState.create({ doc: 'function tick() { }', extensions: [codeHistory()] });
    const at = (t: number) => Transaction.time.of(t);
    // Typed in the code, then a word completed mid-word (a replace, whose undo would put text back in).
    state = state.update({ changes: { from: 18, insert: 'con' }, userEvent: 'input.type', annotations: at(0) }).state;
    state = state.update({ changes: { from: 15, to: 21, insert: 'contacts' }, userEvent: 'input.complete', annotations: at(1000) }).state;
    // The board's Undo puts the first text back from outside, seconds later.
    const specs = outsideChanges(state.doc.toString(), 'function tick() { }');
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) state = state.update(spec, { annotations: at(10_000) }).state;
    expect(state.doc.toString()).toBe('function tick() { }');
    // Cmd+Z in the code: nothing to undo, nothing comes back.
    let ran = false;
    undo({ state, dispatch: (tr) => ((state = tr.state), (ran = true)) });
    expect(ran).toBe(false);
    expect(state.doc.toString()).toBe('function tick() { }');
    expect(outsideChanges('same', 'same')).toEqual([]);
  });
});
