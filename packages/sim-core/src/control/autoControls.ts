import type { Binding, Blueprint } from '../blueprint/types';
import { rotateFace } from '../parts/faces';
import type { PartRegistry } from '../parts/registry';
import type { Face } from '../parts/types';

/** Push parts get the key for the direction they push (`11`). */
const PUSH_KEY: Readonly<Record<Face, string>> = { N: 'w', S: 's', E: 'd', W: 'a' };

/** Keys auto controls can use, in the order the keys bar shows them. */
export const AUTO_KEYS: readonly string[] = ['w', 'a', 's', 'd'];

/**
 * Bindings derived from the parts (`11`), one or two per part that has `autoControl` in its def and has not opted
 * out. Each targets the part by id. Axis parts (wheels): D +max, A -max. Push parts (thrusters, propellers): the key
 * for the direction they push after rotation, at the channel max. None when the blueprint turns auto off.
 */
export function autoBindings(bp: Blueprint, registry: PartRegistry): Binding[] {
  if (bp.autoControls === false) return [];
  const out: Binding[] = [];
  for (const p of bp.parts) {
    if (p.auto === false || !registry.has(p.part)) continue;
    const def = registry.get(p.part);
    const ac = def.autoControl;
    const channel = ac ? def.inputs.find((c) => c.name === ac.channel) : undefined;
    if (!ac || !channel) continue;
    if (ac.kind === 'axis') {
      out.push({ key: 'd', mode: 'hold', target: p.id, channel: channel.name, value: channel.max });
      out.push({ key: 'a', mode: 'hold', target: p.id, channel: channel.name, value: -channel.max });
    } else if (def.acts !== undefined) {
      out.push({ key: PUSH_KEY[rotateFace(def.acts, p.rot)], mode: 'hold', target: p.id, channel: channel.name, value: channel.max });
    }
  }
  return out;
}

/** Auto bindings first (so the keys bar shows W A S D before custom keys), then the blueprint's own. */
export function allBindings(bp: Blueprint, registry: PartRegistry): Binding[] {
  return [...autoBindings(bp, registry), ...bp.bindings];
}
