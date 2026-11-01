import type { Robot, WorldEvent } from '@robots/sim-core';

type Named = Pick<Robot, 'name' | 'brokeFrom' | 'scope'>;

/** A piece that broke off keeps its parent's name, so a notice about it under that name reads as the parent's own. */
export function pieceName(r: Named): string {
  if (r.brokeFrom === undefined) return r.name;
  return r.scope === undefined ? `A piece of ${r.name}` : `${r.scope} (a piece of ${r.name})`;
}

/**
 * What a notice about robot `id` calls it, or undefined for no notice. Bays and decouplers send pieces off by the dozen,
 * and what becomes of each is news only to someone following that one.
 */
export function noticeName(r: Named, id: number, following: number | undefined): string | undefined {
  return r.brokeFrom !== undefined && id !== following ? undefined : pieceName(r);
}

/** The notice an event posts, if any. `who` is its robot, while that is still in the world; `following` is the camera's. */
export function eventNotice(ev: WorldEvent, who: Robot | undefined, following: number | undefined): string | undefined {
  if (ev.kind === 'fell') {
    // The robot is gone by now, so the event carries its name. Only your own, and only a robot with a core: not scrap.
    const name = ev.team === 0 && ev.core ? noticeName(ev, ev.robot, following) : undefined;
    return name && `${name} fell off the edge of the world`;
  }
  if (!who) return undefined;
  const name = noticeName(who, who.id, following);
  switch (ev.kind) {
    case 'energyEmpty':
      return name && `${name} ran out of energy`;
    case 'overload':
      return name && `${name}: reactor past its rating, heat is cooking its batteries`;
    case 'coreLost':
      return name && `${name} lost its core: nobody controls it now, and it keeps doing what it was doing`;
    case 'scriptCrashed':
      // Told of any piece: a script that stopped is a fault in the robot, not the end of one more dart.
      return `${pieceName(who)}: script "${ev.script}" stopped. ${ev.error.message}`;
    case 'coreWoke':
      // Only your own: an enemy's missiles wake too, and you cannot take them over.
      return who.team === 0 ? `A core woke up in a piece that broke off ${who.name}: click it to control it` : undefined;
    default:
      return undefined;
  }
}
