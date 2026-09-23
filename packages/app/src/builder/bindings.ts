import { autoBindings, matchesTarget, partAutoBindings, type Binding, type Blueprint, type ChannelDef, type PartRegistry, type PlacedPart } from '@robots/sim-core';

/**
 * What a binding can target: part types present ("all wheels"), explicit tags (groups), then single parts. Only
 * targets with at least one input channel are offered, so a binding can always name a channel (an empty channel
 * would make the file unreadable).
 */
export function bindingTargets(bp: Blueprint, registry: PartRegistry): { types: string[]; tags: string[]; parts: string[] } {
  const types: string[] = [];
  const tags = new Set<string>();
  const parts: string[] = [];
  for (const p of bp.parts) {
    const hasInputs = registry.has(p.part) && registry.get(p.part).inputs.length > 0;
    if (hasInputs && !types.includes(p.part)) types.push(p.part);
    for (const t of p.tags) if (t !== p.id) tags.add(t);
    if (hasInputs) parts.push(p.id);
  }
  return { types, tags: [...tags].filter((t) => !types.includes(t) && channelsForTarget(bp, registry, t).length > 0).sort(), parts };
}

/** "all wheels": how the target list names a part type. */
export function typeLabel(registry: PartRegistry, part: string): string {
  const name = registry.has(part) ? registry.get(part).name.toLowerCase() : part;
  return `all ${name}s`;
}

/** Input channels available on the parts this target reaches (tag, type, or id), by name, in first-seen order. */
export function channelsForTarget(bp: Blueprint, registry: PartRegistry, target: string): ChannelDef[] {
  const out: ChannelDef[] = [];
  for (const p of bp.parts) {
    if (!matchesTarget(p, target) || !registry.has(p.part)) continue;
    for (const c of registry.get(p.part).inputs) if (!out.some((o) => o.name === c.name)) out.push(c);
  }
  return out;
}

// Side view: A and D drive, so they come first (Logan, Gate 2).
const KEY_ORDER = 'dawsqezxcfrtgvbyhnujmikolp1234567890'.split('');

/**
 * A new binding: the first key not used by a custom or an auto control (so it never doubles up on the wheels), the
 * first target that has channels, its first channel at full value.
 */
export function defaultBinding(bp: Blueprint, registry: PartRegistry): Binding {
  const t = bindingTargets(bp, registry);
  const target = t.tags[0] ?? t.types[0] ?? t.parts[0] ?? '';
  const channel = channelsForTarget(bp, registry, target)[0];
  const used = new Set([...bp.bindings, ...autoBindings(bp, registry)].map((b) => b.key));
  const key = KEY_ORDER.find((k) => !used.has(k)) ?? 'q';
  return { key, mode: 'hold', target, channel: channel?.name ?? '', value: channel?.max ?? 1 };
}

/** A channel value as the builder shows it: +100% is full forward, -100% full reverse. */
export function percent(v: number): string {
  const n = Math.round(v * 100);
  return `${n > 0 ? '+' : ''}${n}%`;
}

/**
 * The auto controls, one line per key in W A S D order, like "D: 4 wheels forward, 1 thruster". Grouped by part type
 * and direction so a robot with 32 wheels is still one short line.
 */
export function autoSummary(bp: Blueprint, registry: PartRegistry): Array<{ key: string; text: string }> {
  const byKey = new Map<string, Map<string, number>>();
  const byId = new Map(bp.parts.map((p) => [p.id, p]));
  for (const b of autoBindings(bp, registry)) {
    const p = byId.get(b.target ?? '');
    if (!p) continue;
    const def = registry.get(p.part);
    const what = def.autoControl?.kind === 'axis' ? `${def.name.toLowerCase()}|${(b.value ?? 0) > 0 ? 'forward' : 'reverse'}` : `${def.name.toLowerCase()}|`;
    const m = byKey.get(b.key) ?? new Map<string, number>();
    m.set(what, (m.get(what) ?? 0) + 1);
    byKey.set(b.key, m);
  }
  const order = ['w', 'a', 's', 'd'];
  return [...byKey]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([key, m]) => ({
      key: key.toUpperCase(),
      text: [...m]
        .map(([what, n]) => {
          const [name = '', dir = ''] = what.split('|');
          return `${n} ${name}${n === 1 ? '' : 's'}${dir ? ` ${dir}` : ''}`;
        })
        .join(', '),
    }));
}

/** What auto controls give one part, for its menu: "D forward, A reverse" or "W (pushes up)". Undefined when none. */
export function autoLabel(registry: PartRegistry, part: PlacedPart): string | undefined {
  const b = partAutoBindings(part, registry);
  if (b.length === 0) return undefined;
  if (b.length === 2) return 'D forward, A reverse';
  const dir: Record<string, string> = { w: 'up', s: 'down', a: 'left', d: 'right' };
  const key = b[0]?.key ?? '';
  return `${key.toUpperCase()} (pushes ${dir[key] ?? key})`;
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
