import { describe, expect, it } from 'vitest';
import { defaultRegistry, expandBlueprint, type Blueprint } from '@robots/sim-core';
import { fixIsSafe, issueLine, problemLine, safeFix, scriptSourceAt } from '../src/builder/problemText';
import { scriptProblems } from '../src/builder/scriptView';

const reg = defaultRegistry();
const robot = (source: string): Blueprint => ({
  ...(expandBlueprint({
    format: 1,
    name: 't',
    grid: ['P C Q'],
    legend: { P: { part: 'propeller', tags: ['lprop'] }, Q: { part: 'propeller', tags: ['rprop'] } },
  }).blueprint as Blueprint),
  scripts: [{ id: 'pilot', enabled: true, params: {}, source, file: 't.pilot.js' }],
});

describe('a problem as one line', () => {
  it('says who and what for a dead name', () => {
    const message =
      "script 'pilot' (enemy-many-gun-drone.pilot.js) line 211: get('bay', ...) reaches nothing: no part has that tag, part type, or id (tags here: stab, lprop, rprop, and 31 more; part types here: gun, frame)";
    expect(problemLine({ code: 'SCRIPT_TARGET', message })).toBe("pilot, line 211: 'bay' reaches nothing");
  });

  it('reads the line the real check writes', () => {
    const [p] = scriptProblems(robot("function tick() {\n  set('bay', 'throttle', 1);\n}"), reg);
    expect(p?.code).toBe('SCRIPT_TARGET');
    expect(problemLine(p as NonNullable<typeof p>)).toBe("pilot, line 2: 'bay' reaches nothing");
  });

  it('says which input is wrong, for a write and for a read', () => {
    const [w] = scriptProblems(robot("function tick() {\n  set('lprop', 'throtle', 1);\n}"), reg);
    expect(w?.code).toBe('SCRIPT_CHANNEL');
    expect(problemLine(w as NonNullable<typeof w>)).toBe("pilot, line 2: 'lprop' has no 'throtle' input");
    const [r] = scriptProblems(robot("function tick() {\n  log(get('lprop', 'heat'));\n}"), reg);
    expect(problemLine(r as NonNullable<typeof r>)).toBe("pilot, line 2: 'lprop' has nothing to read called 'heat'");
  });

  it('names whose script it is, and counts the copies', () => {
    const message = "core core@5,5 (missile1): script 'guide' line 4: set('fins', ...) reaches nothing: no part has that tag; the same in 11 more copies of this script (core a, core b, core c, and 8 more)";
    expect(problemLine({ code: 'SCRIPT_TARGET', message })).toBe("guide (core core@5,5 (missile1)), line 4: 'fins' reaches nothing, in 12 copies");
  });

  it('falls back to the first clause of a message it does not know', () => {
    expect(problemLine({ code: 'SCRIPT_OTHER', message: 'something else went wrong. More about it here.' })).toBe('something else went wrong');
    expect(issueLine('blueprint has no parts')).toBe('blueprint has no parts');
    expect(issueLine('part wheel@3,2 is not connected to the core (it would fall off at spawn)')).toBe('part wheel@3,2 is not connected to the core');
    expect(issueLine('No core: a robot needs a Core to do anything.')).toBe('No core: a robot needs a Core to do anything');
  });
});

describe('"point it at X" is only for a near-misspelling', () => {
  it('is offered for a name a letter or two away that the script does not use elsewhere', () => {
    const source = "function tick() {\n  set('lprp', 'throttle', 1);\n}";
    expect(fixIsSafe({ from: 'lprp', to: 'lprop' }, source)).toBe(true);
    const bp = robot(source);
    const [p] = scriptProblems(bp, reg);
    expect(p?.fix?.to).toBe('lprop');
    expect(safeFix(p as NonNullable<typeof p>, bp, reg)?.to).toBe('lprop');
  });

  it('is not offered when the script already uses that name: dprop is not a mistyped lprop', () => {
    const source = "function tick() {\n  set('lprop', 'throttle', 1);\n  set('rprop', 'throttle', 1);\n  set('dprop', 'throttle', 1);\n}";
    expect(fixIsSafe({ from: 'dprop', to: 'lprop' }, source)).toBe(false);
    const bp = robot(source);
    const [p] = scriptProblems(bp, reg);
    // The engine still names the nearest real name; the builder no longer offers to rewrite to it.
    expect(p?.fix?.to).toBe('lprop');
    expect(safeFix(p as NonNullable<typeof p>, bp, reg)).toBeUndefined();
    // The script can still be opened at the line.
    expect(p?.open).toEqual({ id: 'pilot' });
  });

  it('is not offered for a name more than two letters away, or when the code cannot be read', () => {
    expect(fixIsSafe({ from: 'bay', to: 'lprop' }, "set('bay', 'x', 1)")).toBe(false);
    expect(fixIsSafe({ from: 'lpr', to: 'lprop' }, "set('lpr', 'x', 1)")).toBe(true);
    expect(fixIsSafe({ from: 'lp', to: 'lprop' }, "set('lp', 'x', 1)")).toBe(false);
    expect(fixIsSafe({ from: 'lprp', to: 'lprop' }, undefined)).toBe(false);
  });

  it('finds the code of a script wherever it lives', () => {
    const bp = robot('function tick() {}');
    expect(scriptSourceAt(bp, reg, { id: 'pilot', recipes: [] })).toBe('function tick() {}');
    expect(scriptSourceAt(bp, reg, { id: 'nope', recipes: [] })).toBeUndefined();
    const outer: Blueprint = { ...robot(''), recipes: [{ name: 'drone', blueprint: bp }] };
    expect(scriptSourceAt(outer, reg, { id: 'pilot', recipes: ['drone'] })).toBe('function tick() {}');
  });
});
