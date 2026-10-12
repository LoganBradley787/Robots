import { describe, expect, it } from 'vitest';
import { allScripts, assignScriptFiles, resolveScripts, scriptFileClash, scriptFileName, scriptFiles } from '../src/blueprint/scripts';
import { expandBlueprint } from '../src/blueprint/expand';
import { toFileJson } from '../src/blueprint/serialize';
import { validateBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';
import type { Blueprint } from '../src/blueprint/types';

const reg = defaultRegistry();
const onDisk = { format: 1, name: 'drone', grid: ['P  C  P'], scripts: [{ id: 'hover', source: { file: 'drone.hover.js' } }, { id: 'aux', enabled: false, source: { file: 'drone.aux.js' } }] };
const files: Record<string, string> = { 'drone.hover.js': 'function tick() {}' };

describe('script files', () => {
  it('resolves file sources into code and lists missing files', () => {
    const r = resolveScripts(onDisk, (f) => files[f]);
    expect(r.missing).toEqual(['drone.aux.js']);
    const bp = expandBlueprint(r.raw).blueprint as Blueprint;
    expect(bp.scripts[0]).toEqual({ id: 'hover', enabled: true, params: {}, source: 'function tick() {}', file: 'drone.hover.js' });
    expect(bp.scripts[1]).toEqual({ id: 'aux', enabled: false, params: {}, source: { file: 'drone.aux.js' }, file: 'drone.aux.js' });
  });

  it('saves as references and deploys inline', () => {
    const bp = expandBlueprint(resolveScripts(onDisk, (f) => files[f]).raw).blueprint as Blueprint;
    expect(toFileJson(bp, reg).scripts).toEqual(onDisk.scripts);
    expect(toFileJson(bp, reg, { inlineScripts: true }).scripts).toEqual([
      { id: 'hover', source: 'function tick() {}', file: 'drone.hover.js' },
      { id: 'aux', enabled: false, source: { file: 'drone.aux.js' } },
    ]);
    expect(scriptFiles(bp)).toEqual([{ file: 'drone.hover.js', text: 'function tick() {}' }]);
  });

  it('names files after the blueprint and reassigns them for Save As', () => {
    expect(scriptFileName('drone.json', 'Hover Mode')).toBe('drone.hover-mode.js');
    const bp = expandBlueprint({ format: 1, name: 'd', grid: ['C'], scripts: [{ id: 'hover', source: 'function tick(){}' }] }).blueprint as Blueprint;
    expect(assignScriptFiles(bp, 'drone.json', true).scripts[0]?.file).toBe('drone.hover.js');
    const copied = assignScriptFiles(assignScriptFiles(bp, 'drone.json', true), 'drone-2.json', false);
    expect(copied.scripts[0]?.file).toBe('drone-2.hover.js');
  });

  it('the validator refuses duplicate ids and file names outside blueprints/', () => {
    const dup = validateBlueprint({ format: 1, name: 'd', grid: ['C'], scripts: [{ id: 'a', source: 'x' }, { id: 'a', source: 'y' }] }, reg);
    expect(dup.issues.map((i) => i.code)).toContain('BAD_SCRIPT');
    const path = validateBlueprint({ format: 1, name: 'd', grid: ['C'], scripts: [{ id: 'a', source: { file: '../evil.js' } }] }, reg);
    expect(path.issues.find((i) => i.code === 'BAD_SCRIPT')?.message).toContain("must be a plain name");
  });
});

describe('script files do not collide (M5 review)', () => {
  it('a new script never takes a file another script uses, and unloaded scripts keep theirs on Save As', () => {
    const bp = expandBlueprint({
      format: 1,
      name: 'd',
      grid: ['C'],
      scripts: [
        { id: 'old', source: 'a', file: 'drone.hover.js' },
        { id: 'hover', source: 'b' },
        { id: 'lost', source: { file: 'drone.lost.js' } },
      ],
    }).blueprint as Blueprint;
    const saved = assignScriptFiles(bp, 'drone.json', true);
    expect(saved.scripts.map((s) => s.file)).toEqual(['drone.hover.js', 'drone.hover-2.js', 'drone.lost.js']);
    const copy = assignScriptFiles(saved, 'copy.json', false);
    expect(copy.scripts.map((s) => s.file)).toEqual(['copy.old.js', 'copy.hover.js', 'drone.lost.js']);
    const shared = validateBlueprint({ format: 1, name: 'd', grid: ['C'], scripts: [{ id: 'a', source: 'x', file: 'same.js' }, { id: 'b', source: 'y', file: 'same.js' }] }, reg);
    expect(shared.issues.find((i) => i.code === 'BAD_SCRIPT')?.message).toContain("two scripts use the file 'same.js'");
  });
});

describe("a core's script and a recipe's script never share a file (review E2)", () => {
  // A second core scoped `child` with a script `guide`, and a recipe named `child` with a `guide` of its own.
  const raw = {
    format: 1,
    name: 'mother',
    grid: ['C C'],
    cores: { 'core@1,0': { scope: 'child', scripts: [{ id: 'guide', source: 'function tick() { /* core */ }' }] } },
    recipes: { child: { format: 1, name: 'child', grid: ['C'], scripts: [{ id: 'guide', source: 'function tick() { /* recipe */ }' }] } },
  };

  it('Save As gives each its own file, and nothing is lost', () => {
    const bp = expandBlueprint(raw).blueprint as Blueprint;
    const copy = assignScriptFiles(bp, 'mother.json', false);
    expect(allScripts(copy).map((s) => s.file)).toEqual(['mother.child.guide.js', 'mother.child.guide-2.js']);
    expect(scriptFiles(copy).map((f) => f.text)).toEqual(['function tick() { /* core */ }', 'function tick() { /* recipe */ }']);
    expect(scriptFileClash(copy)).toBeUndefined();
    expect(validateBlueprint(toFileJson(copy, reg), reg).issues.filter((i) => i.code === 'BAD_SCRIPT')).toEqual([]);
    // Save (only scripts without a file get one) keeps the names it gave.
    expect(allScripts(assignScriptFiles(copy, 'mother.json', true)).map((s) => s.file)).toEqual(['mother.child.guide.js', 'mother.child.guide-2.js']);
  });

  it('scriptFileClash names a file two scripts would be written to', () => {
    const bp = expandBlueprint({ format: 1, name: 'd', grid: ['C'], scripts: [{ id: 'a', source: 'x', file: 'same.js' }, { id: 'b', source: 'y', file: 'same.js' }] }).blueprint as Blueprint;
    expect(scriptFileClash(bp)).toBe('same.js');
  });
});
