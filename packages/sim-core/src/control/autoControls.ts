import type { Binding, Blueprint, PlacedPart } from '../blueprint/types';
import { rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';

/** Push parts get the key for the direction they push (`11`). */
const PUSH_KEY: Readonly<Record<Face, string>> = { N: 'w', S: 's', E: 'd', W: 'a' };

/** Keys auto controls use, in the order the keys bar shows them. */
export const AUTO_KEYS: readonly string[] = ['q', 'w', 'e', 'a', 's', 'd'];

/**
 * Bindings derived from the parts (`11`), one or two per part that has `autoControl` in its def and has not opted
 * out. Each targets the part by id. Axis parts: their two keys at the channel max and min (wheels D and A, gyro E and Q). Push parts (thrusters, propellers): the key
 * for the direction they push after rotation, at the channel max. None when the blueprint turns auto off.
 */
export function autoBindings(bp: Blueprint, registry: PartRegistry): Binding[] {
  if (bp.autoControls === false) return [];
  return bp.parts.flatMap((p) => (p.auto === false ? [] : partAutoBindings(p, registry)));
}

/** The auto bindings one part would get, ignoring its opt-out (the builder shows them next to the checkbox). */
export function partAutoBindings(p: PlacedPart, registry: PartRegistry): Binding[] {
  if (!registry.has(p.part)) return [];
  const def = registry.get(p.part);
  const ac = def.autoControl;
  const channel = ac ? def.inputs.find((c) => c.name === ac.channel) : undefined;
  if (!ac || !channel) return [];
  if (ac.kind === 'axis') {
    const [pos, neg] = ac.keys ?? ['d', 'a'];
    return [
      { key: pos, mode: 'hold', target: p.id, channel: channel.name, value: channel.max },
      { key: neg, mode: 'hold', target: p.id, channel: channel.name, value: channel.min },
    ];
  }
  if (def.acts === undefined) return [];
  return [{ key: PUSH_KEY[rotateFace(def.acts, p.rot)], mode: 'hold', target: p.id, channel: channel.name, value: channel.max }];
}

/** Auto bindings first (so the keys bar shows W A S D before custom keys), then the blueprint's own. */
export function allBindings(bp: Blueprint, registry: PartRegistry): Binding[] {
  return [...autoBindings(bp, registry), ...bp.bindings];
}
