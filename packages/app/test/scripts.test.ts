import { describe, expect, it } from 'vitest';
import { blankBlueprint } from '@robots/sim-core';
import { addScript, cleanScriptId, NEW_SCRIPT, removeScript, renameScript, updateScript } from '../src/builder/scripts';

describe('builder script edits', () => {
  it('adds scripts with free ids and the starter code', () => {
    const a = addScript(blankBlueprint('b'));
    const b = addScript(a.bp);
    expect([a.id, b.id]).toEqual(['script', 'script2']);
    expect(b.bp.scripts[0]).toEqual({ id: 'script', enabled: true, params: {}, source: NEW_SCRIPT });
  });

  it('renames a script and its bindings; refuses empty or taken names', () => {
    const { bp } = addScript(blankBlueprint('b'));
    const bound = { ...bp, bindings: [{ key: 'h', mode: 'script' as const, script: 'script' }] };
    const r = renameScript(bound, 'script', 'Hover Mode');
    expect(r.scripts[0]?.id).toBe('hover-mode');
    expect(r.bindings[0]?.script).toBe('hover-mode');
    expect(renameScript(r, 'hover-mode', '  ')).toBe(r);
    const two = addScript(r).bp;
    expect(renameScript(two, 'script', 'hover-mode')).toBe(two);
    expect(cleanScriptId(' --Lift!! ')).toBe('lift');
  });

  it('removes a script with its bindings, and updates only on a real change', () => {
    const { bp } = addScript(blankBlueprint('b'));
    const bound = { ...bp, bindings: [{ key: 'h', mode: 'script' as const, script: 'script' }] };
    expect(removeScript(bound, 'script')).toMatchObject({ scripts: [], bindings: [] });
    expect(updateScript(bound, 'script', { enabled: true })).toBe(bound);
    expect(updateScript(bound, 'script', { enabled: false }).scripts[0]?.enabled).toBe(false);
  });
});
