/**
 * The line for a robot that lost most of itself and kept its core: nothing else says so (`coreLost` is for the other
 * way round), and it can look whole, its core still sitting in a hull that no longer answers. The keys of the parts
 * that went leave the keys bar with them. A break that takes less than the core kept says nothing: robots lose bits.
 */
export function breakNotice(name: string, kept: number, lost: number): string | undefined {
  if (lost <= kept) return undefined;
  return `${name} broke apart: its core kept ${kept} part${kept === 1 ? '' : 's'}, the other ${lost} went off with nobody driving them`;
}
