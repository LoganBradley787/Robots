import { describe, expect, it } from 'vitest';
import { expandBlueprint } from '../src/blueprint/expand';
import type { Blueprint } from '../src/blueprint/types';
import { assemble } from '../src/assembly/assemble';
import { defaultRegistry } from '../src/parts/registry';

const reg = defaultRegistry();

function bp(grid: string[]): Blueprint {
  const r = expandBlueprint({ format: 1, name: 't', grid });
  if (!r.blueprint) throw new Error(JSON.stringify(r.issues));
  return r.blueprint;
}

const car = bp(['F  F  C  B  F  F', 'W  .  .  .  .  W']);

describe('assemble', () => {
  it('turns the car into one chunk with a main body and two wheel bodies', () => {
    const plan = assemble(car, reg);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.groups).toEqual([
      { index: 0, partIds: ['frame@0,1', 'frame@1,1', 'core@2,1', 'battery@3,1', 'frame@4,1', 'frame@5,1'], originId: 'core@2,1' },
      { index: 1, partIds: ['wheel@0,0'], originId: 'wheel@0,0', joint: { partId: 'wheel@0,0', parentGroup: 0 } },
      { index: 2, partIds: ['wheel@5,0'], originId: 'wheel@5,0', joint: { partId: 'wheel@5,0', parentGroup: 0 } },
    ]);
    expect(plan.chunks[0]?.groups).toEqual([0, 1, 2]);
    expect(plan.edges).toHaveLength(7);
    expect(plan.attachedFaces.get('wheel@0,0')).toBe(1);
    expect(plan.attachedFaces.get('frame@1,1')).toBe(2);
  });

  it('does not attach through a thruster nozzle', () => {
    // T^ nozzle faces south, onto the frame below it.
    const plan = assemble(bp(['T^', 'F']), reg);
    expect(plan.edges).toEqual([]);
    expect(plan.chunks).toHaveLength(2);
  });

  it('attaches a thruster through its side faces', () => {
    const plan = assemble(bp(['F T^']), reg);
    expect(plan.edges).toEqual([{ a: 'frame@0,0', b: 'thruster@1,0' }]);
  });

  it('a wheel under nothing has no attached face and is its own chunk', () => {
    const plan = assemble(bp(['.  F', 'W  .']), reg);
    expect(plan.attachedFaces.get('wheel@0,0')).toBe(0);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.groups[1]?.joint).toBeUndefined();
  });

  it('separates frames with a gap into two chunks', () => {
    expect(assemble(bp(['F . F']), reg).chunks).toHaveLength(2);
  });

  it('mounts a sideways wheel to the frame on its left', () => {
    // W> is rot 90: its mount face N turns to W, toward the frame.
    const plan = assemble(bp(['F W>']), reg);
    expect(plan.edges).toEqual([{ a: 'frame@0,0', b: 'wheel@1,0' }]);
    expect(plan.groups[1]?.joint).toEqual({ partId: 'wheel@1,0', parentGroup: 0 });
  });

  it('uses the first part as origin when a group has no root', () => {
    const plan = assemble(bp(['F F']), reg);
    expect(plan.groups[0]?.originId).toBe('frame@0,0');
  });

  it('honors an explicit primary core as the root', () => {
    const b = { ...bp(['C F C']), primaryCore: 'core@2,0' };
    expect(assemble(b, reg).groups[0]?.originId).toBe('core@2,0');
  });

  it('is deterministic', () => {
    expect(assemble(car, reg)).toEqual(assemble(car, reg));
  });
});

describe('assemble on live parts (M6)', () => {
  it('a cut decoupler face splits the chunk; the decoupler stays with its other faces', () => {
    // D releases up (N): the frame above goes, the decoupler stays with the core below.
    const b = bp(['F', 'D', 'C']);
    expect(assemble(b, reg).chunks).toHaveLength(1);
    const plan = assemble(b, reg, undefined, new Map([['decoupler@0,1', ['N']]]));
    expect(plan.chunks.map((c) => c.partIds)).toEqual([['frame@0,2'], ['decoupler@0,1', 'core@0,0']]);
  });

  it('removing a middle part splits a long robot in two', () => {
    const b = bp(['C  F  F  F  F  F', 'W  .  .  .  .  W']);
    const live = { ...b, parts: b.parts.filter((p) => p.id !== 'frame@2,1') };
    const plan = assemble(live, reg);
    expect(plan.chunks.map((c) => c.partIds)).toEqual([
      ['core@0,1', 'frame@1,1', 'wheel@0,0'],
      ['frame@3,1', 'frame@4,1', 'frame@5,1', 'wheel@5,0'],
    ]);
    expect(plan.groups.find((g) => g.partIds.includes('wheel@5,0'))?.joint).toEqual({ partId: 'wheel@5,0', parentGroup: 1 });
  });

  it('a rotator carries the parts on its other faces in its own body, anchored at the rotator', () => {
    // R mounts on the core below it (face S) and carries the frames beside and above it.
    const plan = assemble(bp(['.  F  .', 'F  R  F', '.  C  .']), reg);
    expect(plan.groups).toEqual([
      { index: 0, partIds: ['frame@1,2', 'frame@0,1', 'rotator@1,1', 'frame@2,1'], originId: 'rotator@1,1', joint: { partId: 'rotator@1,1', parentGroup: 1 } },
      { index: 1, partIds: ['core@1,0'], originId: 'core@1,0' },
    ]);
    expect(plan.lockedJoints).toEqual([]);
  });

  it('a rotator whose load also touches its base is locked (it cannot turn)', () => {
    const plan = assemble(bp(['F  F', 'R  F', 'C  F']), reg);
    expect(plan.lockedJoints).toEqual(['rotator@0,1']);
    expect(plan.groups).toHaveLength(1);
  });

  it('every shipped blueprint assembles as before: one chunk, wheels in their own bodies', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../../blueprints/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const r = expandBlueprint(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      if (!r.blueprint) continue;
      const plan = assemble(r.blueprint, reg);
      expect(plan.lockedJoints, f).toEqual([]);
      for (const g of plan.groups) {
        if (g.joint) expect(g.originId, f).toBe(g.joint.partId);
      }
    }
  });
});
