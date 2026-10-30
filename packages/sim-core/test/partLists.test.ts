import { describe, expect, it } from 'vitest';
import { partLists } from '../src/world/partLists';
import type { PartDef } from '../src/parts/types';
import type { PartInstance, Robot } from '../src/world/Robot';

const part = (id: string, def: Partial<PartDef>, group = 0): PartInstance => ({ id, def: def as PartDef, x: 0, y: 0, rot: 0, tags: [], health: 1, group, localX: 0, localY: 0 });

function robot(parts: PartInstance[]): Robot {
  return { parts: new Map(parts.map((p) => [p.id, p])), version: 0 } as unknown as Robot;
}

describe('partLists', () => {
  it('sorts parts by kind, each list in part order', () => {
    const gun = part('gun', { gun: {} as PartDef['gun'] });
    const frame = part('frame', {});
    const pod = part('pod', { smoke: { radius: 1, seconds: 1 } });
    const charge = part('charge', { charge: { radius: 1 } as PartDef['charge'], arming: true });
    const gun2 = part('gun2', { gun: {} as PartDef['gun'] });
    const lists = partLists(robot([gun, frame, pod, charge, gun2]));
    expect(lists.all.map((p) => p.id)).toEqual(['gun', 'frame', 'pod', 'charge', 'gun2']);
    expect(lists.guns).toEqual([gun, gun2]);
    expect(lists.arming).toEqual([pod, charge]);
    expect(lists.charges).toEqual([charge]);
    expect(lists.lasers).toEqual([]);
  });

  it('lists body groups as the parts first name them', () => {
    const lists = partLists(robot([part('a', {}, 3), part('b', {}, 1), part('c', {}, 3), part('d', {}, 0)]));
    expect(lists.groups).toEqual([3, 1, 0]);
  });

  it('shrugs off a hit under the lowest threshold of any part', () => {
    expect(partLists(robot([part('a', {})])).shrugsOff).toBe(12);
    expect(partLists(robot([part('a', {}), part('b', { crash: { safe: 30 } })])).shrugsOff).toBe(12);
    expect(partLists(robot([part('a', { crash: { safe: 30 } })])).shrugsOff).toBe(30);
    expect(partLists(robot([part('a', {}), part('b', { impact: { speed: 5 } as PartDef['impact'] })])).shrugsOff).toBe(5);
    expect(partLists(robot([part('a', {}), part('b', { charge: { radius: 1, crash: 3 } as PartDef['charge'] })])).shrugsOff).toBe(3);
  });

  it('is kept while the robot is as it was and made again when it changes', () => {
    const r = robot([part('a', {}), part('b', {})]);
    const first = partLists(r);
    expect(partLists(r)).toBe(first);
    r.parts.delete('b');
    const second = partLists(r);
    expect(second.all.map((p) => p.id)).toEqual(['a']);
    r.version++;
    expect(partLists(r)).not.toBe(second);
    const third = partLists(r);
    r.parts = new Map(r.parts);
    expect(partLists(r)).not.toBe(third);
  });

  it('marks each part with the robot that holds it', () => {
    const a = part('a', {});
    const whole = robot([a]);
    partLists(whole);
    expect(a.holder).toBe(whole);
    const piece = robot([a]);
    partLists(piece);
    expect(a.holder).toBe(piece);
  });
});
