import type { Binding, Blueprint, ChannelDef, PartRegistry } from '@robots/sim-core';

/** What a binding can target: explicit tags (groups) first, then single parts that have input channels. */
export function bindingTargets(bp: Blueprint, registry: PartRegistry): { tags: string[]; parts: string[] } {
  const tags = new Set<string>();
  const parts: string[] = [];
  for (const p of bp.parts) {
    for (const t of p.tags) if (t !== p.id) tags.add(t);
    if (registry.has(p.part) && registry.get(p.part).inputs.length > 0) parts.push(p.id);
  }
  return { tags: [...tags].sort(), parts };
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

const KEY_ORDER = 'wasdqezxcfrtgvbyhnujmikolp1234567890'.split('');

/** A new binding: the first unused key, the first tag that has channels, its first channel at full value. */
export function defaultBinding(bp: Blueprint, registry: PartRegistry): Binding {
  const t = bindingTargets(bp, registry);
  const target = t.tags.find((tag) => channelsForTarget(bp, registry, tag).length > 0) ?? t.parts[0] ?? '';
  const channel = channelsForTarget(bp, registry, target)[0];
  const used = new Set(bp.bindings.map((b) => b.key));
  const key = KEY_ORDER.find((k) => !used.has(k)) ?? 'w';
  return { key, mode: 'hold', target, channel: channel?.name ?? '', value: channel?.max ?? 1 };
}

/** The key string a binding stores: the lowercase character for printable keys, else the key code. */
export function keyName(e: { key: string; code: string }): string {
  return e.key.length === 1 && e.key !== ' ' ? e.key.toLowerCase() : e.code;
}
