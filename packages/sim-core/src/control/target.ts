/** A binding target names a tag. Every part also answers to its own id (an implicit tag) and its part type. */
export function matchesTarget(p: { part: string; tags: readonly string[] }, target: string): boolean {
  return p.part === target || p.tags.includes(target);
}

/**
 * How a part looks to controls scoped to `scope` (M7, a placed blueprint's core). A member of the scope (it has the tag
 * `missile1`) answers to its id, its part type, and its `missile1.<tag>` tags without the prefix. Any other part answers
 * only to its id, so auto controls still reach it but the scope's tags and part types do not. Without a scope, the
 * part as it is.
 */
export function scopedView(p: { id: string; part: string; tags: readonly string[] }, scope: string | undefined): { part: string; tags: readonly string[] } {
  if (scope === undefined) return { part: p.part, tags: p.tags };
  if (!p.tags.includes(scope)) return { part: '', tags: [p.id] };
  const prefix = `${scope}.`;
  const tags = [p.id];
  for (const t of p.tags) if (t.startsWith(prefix) && !tags.includes(t.slice(prefix.length))) tags.push(t.slice(prefix.length));
  return { part: p.part, tags };
}
