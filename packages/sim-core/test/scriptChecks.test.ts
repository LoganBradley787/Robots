import { describe, expect, it } from 'vitest';
import { loadBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';
import { robotSees, scriptChecks } from '../src/script/checks';
import { codeWords } from '../src/script/reading';

const registry = defaultRegistry();
const bp = (raw: Record<string, unknown>) => loadBlueprint({ format: 1, name: 't', ...raw }, registry).blueprint;

/** Two propellers in the group `lift`, a core, a gyro. Nothing that sees. */
const blind = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'propeller', x: -1, y: 0, tags: ['lift'] },
    { part: 'propeller', x: 1, y: 0, tags: ['lift'] },
    { part: 'gyro', x: 0, y: 1 },
  ],
});
const seeing = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'propeller', x: -1, y: 0, tags: ['lift'] },
    { part: 'propeller', x: 1, y: 0, tags: ['lift'] },
    { part: 'gyro', x: 0, y: 1 },
    { part: 'radar', x: 0, y: 2 },
  ],
});

const kinds = (source: string, on = blind) => scriptChecks(source, on, registry).map((c) => c.kind);

describe('checks as you type', () => {
  it('a clean script has none', () => {
    expect(scriptChecks(`function tick() { set('lift', 'throttle', 1); const s = get('gyro', 'spin'); set('propeller@1,0', 'throttle', s); }`, blind, registry)).toEqual([]);
  });

  it('a dead name: where it is, the nearest real name first, then the rest', () => {
    const source = `function tick() {\n  set("lfit", "throttle", 1);\n}`;
    const [c] = scriptChecks(source, blind, registry);
    expect(c).toMatchObject({ kind: 'target', line: 2 });
    expect(source.slice(c?.start, c?.end)).toBe('"lfit"');
    expect(c?.suggest[0]).toBe('lift');
    expect(c?.suggest).toEqual(expect.arrayContaining(['lift', 'propeller', 'gyro', 'core']));
    expect(c?.message).toBe("No part answers to 'lfit'. Did you mean 'lift'? The names on this robot: lift, core, gyro, propeller.");
  });

  it('an unknown input, at the input itself, with what the part really has', () => {
    const source = `function tick() { set('lift', 'throtle', 1); }`;
    const [c] = scriptChecks(source, blind, registry);
    expect(c?.kind).toBe('input');
    expect(source.slice(c?.start, c?.end)).toBe("'throtle'");
    expect(c?.message).toBe("'throtle' is not an input of a propeller. Did you mean 'throttle'? It has: throttle.");
    expect(c?.suggest).toEqual(['throttle']);
  });

  it('an unknown output of a get, and an input no part has on a name built in code', () => {
    expect(scriptChecks(`function tick() { get('gyro', 'distance'); }`, blind, registry)[0]?.message).toMatch(/^'distance' is not something a gyro takes or reports\./);
    const built = scriptChecks(`function tick() { for (const p of parts) set(p.id, 'throtle', 1); }`, blind, registry);
    expect(built.map((c) => c.kind)).toEqual(['input']);
    expect(built[0]?.message).toBe("No part has an input called 'throtle'. Did you mean 'throttle'?");
    // A name built in code with a real input is never guessed at.
    expect(kinds(`function tick() { for (const p of parts) set(p.id, 'throttle', 1); }`)).toEqual([]);
  });

  it('contacts with nothing that sees: said once, at its first use, and not when the robot sees', () => {
    const source = `function tick() {\n  const c = contacts[0];\n  if (contacts.length > 1) log(c.distance);\n}`;
    const found = scriptChecks(source, blind, registry);
    expect(found.map((c) => c.kind)).toEqual(['sees']);
    expect(found[0]?.line).toBe(2);
    expect(found[0]?.message).toBe('contacts is always empty here. Nothing on this robot sees: add a part that does, such as a radar.');
    expect(kinds(source, seeing)).toEqual([]);
    expect(robotSees(blind, registry)).toBe(false);
    expect(robotSees(seeing, registry)).toBe(true);
    // Not the global: a property, a word in a comment or a string, the script's own variable.
    expect(kinds(`function tick() { const x = { contacts: 1 }; log(x.contacts, 'contacts'); } // contacts`)).toEqual([]);
    expect(kinds(`function tick() { const contacts = []; log(contacts.length); }`)).toEqual([]);
    expect(kinds(`function tick() { scan(3); }`)).toEqual(['sees']);
  });

  it('no tick()', () => {
    const found = scriptChecks(`function setup() { state.n = 0; }\n`, blind, registry);
    expect(found.map((c) => c.kind)).toEqual(['tick']);
    expect(found[0]?.line).toBe(1);
    expect(kinds(`tick = function () {};`)).toEqual([]);
    expect(kinds(`const f = () => {}; globalThis.tick = f;`)).toEqual([]);
    // A comparison is not a definition.
    expect(kinds(`function setup() { if (tick == 3) log(1); }`)).toEqual(['tick']);
  });

  it('a scoped core is judged by its own parts', () => {
    const two = bp({
      parts: [
        { part: 'core', x: 0, y: 0 },
        { part: 'radar', x: 0, y: 1 },
        { part: 'core', x: 1, y: 0, tags: ['m1'] },
        { part: 'thruster', x: 1, y: -1, tags: ['m1', 'm1.push'] },
      ],
      cores: { 'core@1,0': { scope: 'm1', bindings: [], scripts: [] } },
    });
    const source = `function tick() { set('push', 'throttle', contacts.length); }`;
    // The missile's own core: `push` is its group, and it has nothing that sees (the radar is the carrier's).
    expect(scriptChecks(source, two, registry, 'm1').map((c) => c.kind)).toEqual(['sees']);
    // The carrier's core: it sees, and `push` is not one of its names.
    expect(scriptChecks(source, two, registry).map((c) => c.kind)).toEqual(['target']);
  });
});

describe('codeWords', () => {
  it('lists bare words with their neighbours, leaving out comments and strings', () => {
    const w = codeWords(`// tick\nfunction tick() { a.contacts; 'contacts'; }`);
    expect(w.map((x) => x.text)).toEqual(['function', 'tick', 'a', 'contacts']);
    expect(w[1]).toMatchObject({ before: 'function', after: '(', line: 2 });
    expect(w[3]).toMatchObject({ before: '.', after: ';' });
  });
});
