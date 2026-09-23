import type { Binding, Blueprint, ChannelDef, PartRegistry } from '@robots/sim-core';

/**
 * What a binding can target: explicit tags (groups) first, then single parts. Only targets with at least one input
 * channel are offered, so a binding can always name a channel (an empty channel would make the file unreadable).
 */
export function bindingTargets(bp: Blueprint, registry: PartRegistry): { tags: string[]; parts: string[] } {
  const tags = new Set<string>();
  const parts: string[] = [];
  for (const p of bp.parts) {
    for (const t of p.tags) if (t !== p.id) tags.add(t);
    if (registry.has(p.part) && registry.get(p.part).inputs.length > 0) parts.push(p.id);
  }
  return { tags: [...tags].filter((t) => channelsForTarget(bp, registry, t).length > 0).sort(), parts };
}

/** Input channels available on the parts with this tag, by name, in first-seen order. */
export function channelsForTarget(bp: Blueprint, registry: PartRegistry, target: string): ChannelDef[] {
  const out: ChannelDef[] = [];
  for (const p of bp.parts) {
    if (!p.tags.includes(target) || !registry.has(p.part)) continue;
    for (const c of registry.get(p.part).inputs) if (!out.some((o) => o.name === c.name)) out.push(c);
  }
  return out;
}

// Side view: A and D drive, so they come first (Logan, Gate 2).
const KEY_ORDER = 'dawsqezxcfrtgvbyhnujmikolp1234567890'.split('');

/** A new binding: the first unused key, the first tag that has channels, its first channel at full value. */
export function defaultBinding(bp: Blueprint, registry: PartRegistry): Binding {
  const t = bindingTargets(bp, registry);
  const target = t.tags[0] ?? t.parts[0] ?? '';
  const channel = channelsForTarget(bp, registry, target)[0];
  const used = new Set(bp.bindings.map((b) => b.key));
  const key = KEY_ORDER.find((k) => !used.has(k)) ?? 'w';
  return { key, mode: 'hold', target, channel: channel?.name ?? '', value: channel?.max ?? 1 };
}

/**
 * The key string a binding stores, from the physical key (`code`), so it does not change with keyboard layout or
 * Shift: letters and digits as `a` and `1`, everything else as its code (`Space`, `ArrowUp`, `Comma`).
 */
export function keyName(e: { key?: string; code: string }): string {
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return (letter[1] ?? '').toLowerCase();
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) return digit[1] ?? '';
  return e.code;
}
