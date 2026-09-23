import { describe, expect, it } from 'vitest';
import { assignScriptFiles, resolveScripts, scriptFileName, scriptFiles } from '../src/blueprint/scripts';
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
