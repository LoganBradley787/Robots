/** A binding target names a tag. Every part also answers to its own id (an implicit tag) and its part type. */
export function matchesTarget(p: { part: string; tags: readonly string[] }, target: string): boolean {
  return p.part === target || p.tags.includes(target);
}

/**
 * How a part looks to controls scoped to `scope` (M7, a placed blueprint's core). Every part answers to its id and its
 * part type, so a part placed by hand into a placed missile is still that missile's `warhead`. A member of the scope
 * (it has the tag `missile1`) also answers to its `missile1.<tag>` tags without the prefix; other parts' tags are
 * hidden, so the robot's own tags never reach the missile's controls. Without a scope, the part as it is. These
 * controls only run once the core's piece breaks off, so a part type then means that piece's parts.
 */
export function scopedView(p: { id: string; part: string; tags: readonly string[] }, scope: string | undefined): { part: string; tags: readonly string[] } {
  if (scope === undefined) return { part: p.part, tags: p.tags };
  if (!p.tags.includes(scope)) return { part: p.part, tags: [p.id] };
  const prefix = `${scope}.`;
  const tags = [p.id];
  for (const t of p.tags) if (t.startsWith(prefix) && !tags.includes(t.slice(prefix.length))) tags.push(t.slice(prefix.length));
  return { part: p.part, tags };
}
