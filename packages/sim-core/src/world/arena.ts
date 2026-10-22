/**
 * The edge of a match's ground (`WorldOptions.arena`), as scripts read it (the global `arena`, `04`): a robot is in
 * while |x| <= x and y <= y, in meters. Only a match has one (the CLI's `duel` and `tournament`, the app's `?duel=`
 * page); a plain sandbox world has none. The world only hands it to scripts: whoever runs the match judges a robot out.
 */
export interface Arena {
  x: number;
  y: number;
}

/** The titans tournament's edge (docs/plans/titans-tournament.md): what `pnpm sim duel` and the `?duel=` page use. */
export const MATCH_ARENA: Readonly<Arena> = { x: 1000, y: 250 };

/** Whether a point is inside the arena (on the edge counts as in). */
export function inArena(arena: Readonly<Arena>, p: { x: number; y: number }): boolean {
  return Math.abs(p.x) <= arena.x && p.y <= arena.y;
}
