import { categoryOf, PART_CATEGORIES, type PartDef } from '@robots/sim-core';

/** One saved robot as the store lists it. */
export interface SavedRobot {
  file: string;
  name: string;
  /** What kind of robot it is (`kind` in its file). Absent: none set. */
  kind?: string;
}

/** The group for robots with no kind, shown last. */
export const NO_KIND = 'no kind';
/** Kinds offered even when no robot has them yet. Mine first: it is where the player's own robots go. */
export const USUAL_KINDS: readonly string[] = ['yours', 'enemy', 'missile', 'piece'];

/** A kind as it is stored: lower case, single spaces, at most 40 characters. Undefined for nothing. */
export function cleanKind(text: string): string | undefined {
  const k = text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  return k === '' || k === NO_KIND ? undefined : k;
}

/** Every word typed appears somewhere in the name, file or kind (any order, any case). */
export function matches(f: SavedRobot, query: string): boolean {
  const hay = `${f.name} ${f.file} ${f.kind ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => hay.includes(w));
}

/** Kinds in the order shown: the usual ones first (as listed), then any others by name. */
function kindOrder(a: string, b: string): number {
  const ia = USUAL_KINDS.indexOf(a);
  const ib = USUAL_KINDS.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia >= 0 ? ia : USUAL_KINDS.length) - (ib >= 0 ? ib : USUAL_KINDS.length);
  return a.localeCompare(b);
}

/** Every kind there is to pick: the usual ones, and each one a robot (or the open one) has. */
export function kindsOf(files: readonly SavedRobot[], also?: string): string[] {
  const kinds = new Set<string>(USUAL_KINDS);
  for (const f of files) if (f.kind !== undefined) kinds.add(f.kind);
  if (also !== undefined) kinds.add(also);
  return [...kinds].sort(kindOrder);
}

/**
 * The robots that match the search, grouped by kind for the library and the Assemblies tab: the usual kinds first,
 * other kinds by name, robots with no kind last; names in order inside each. Nothing is hidden. Empty groups are left out.
 */
export function groupByKind<T extends SavedRobot>(files: readonly T[], query = ''): Array<{ kind: string; files: T[] }> {
  const groups = new Map<string, T[]>();
  for (const f of files) {
    if (!matches(f, query)) continue;
    const k = f.kind ?? NO_KIND;
    const list = groups.get(k) ?? [];
    list.push(f);
    groups.set(k, list);
  }
  return [...groups]
    .sort(([a], [b]) => (a === NO_KIND ? 1 : b === NO_KIND ? -1 : kindOrder(a, b)))
    .map(([kind, list]) => ({ kind, files: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Does a part match what was typed in the drawer's search: its name, what it does, its section, or its id. */
export function partMatches(def: PartDef, query: string): boolean {
  const hay = `${def.name} ${def.about ?? ''} ${categoryOf(def)} ${def.id}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => hay.includes(w));
}

/** The drawer's sections: every part of the registry under its category, in registry order. Empty sections are left out. */
export function partSections(defs: readonly PartDef[], query = ''): Array<{ category: string; parts: PartDef[] }> {
  return PART_CATEGORIES.map((category) => ({ category, parts: defs.filter((d) => categoryOf(d) === category && partMatches(d, query)) })).filter((s) => s.parts.length > 0);
}
