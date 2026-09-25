import { isRotation, type Orientation, type Rotation } from '@robots/sim-core';

/** How a robot is deployed (M8): its team and which way it faces. */
export interface SpawnSpec extends Orientation {
  team: number;
}

/** `enemy` is team 1, `yours` team 0, or a team number. */
export function parseTeam(raw: string): number {
  const t = raw.trim().toLowerCase();
  if (t === 'yours' || t === 'mine') return 0;
  if (t === 'enemy') return 1;
  if (/^\d+$/.test(t)) return Number(t);
  throw new Error(`team must be yours, enemy, or a team number, got ${raw}`);
}

/**
 * The suffixes after a drop's position, like `:enemy:flip:rot90`: a team (`enemy`, `yours`, `team2`), `flip`, and a turn
 * (`rot90`, `rot180`, `rot270`), in any order.
 */
export function parseSpawnSuffixes(parts: readonly string[], where: string): SpawnSpec {
  const spec: SpawnSpec = { team: 0 };
  for (const raw of parts) {
    const s = raw.trim().toLowerCase();
    const team = /^team(\d+)$/.exec(s);
    const rot = /^rot(\d+)$/.exec(s);
    if (s === 'enemy' || s === 'yours') spec.team = parseTeam(s);
    else if (team) spec.team = Number(team[1]);
    else if (s === 'flip') spec.flip = true;
    else if (rot && isRotation(Number(rot[1]))) spec.rot = Number(rot[1]) as Rotation;
    else throw new Error(`${where}: '${raw}' is not enemy, yours, team<n>, flip, rot90, rot180, or rot270`);
  }
  return spec;
}
