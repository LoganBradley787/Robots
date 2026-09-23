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
