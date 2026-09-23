/** A binding target names a tag. Every part also answers to its own id (an implicit tag) and its part type. */
export function matchesTarget(p: { part: string; tags: readonly string[] }, target: string): boolean {
  return p.part === target || p.tags.includes(target);
}
