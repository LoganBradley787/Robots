import type { Rotation } from '@robots/sim-core';
import { teamName } from './deploySettings';

/**
 * What a press on the world does while a robot is held for dropping (Logan, 2026-10-19: several of the same robot
 * without going back to the builder). A click drops it and stops placing; Shift+click drops it and keeps the same
 * robot in hand, with the same team, flip and turn, for the next. A click where it does not fit drops nothing and
 * keeps it in hand. A right click stops placing, as it puts the remove cursor away. The middle button still drags
 * the view.
 */
export type PlacePress = 'drop' | 'drop-and-keep' | 'nothing' | 'stop' | 'pass';

export function placePress(button: number, shift: boolean, fits: boolean): PlacePress {
  if (button === 2) return 'stop';
  if (button !== 0) return 'pass';
  if (!fits) return 'nothing';
  return shift ? 'drop-and-keep' : 'drop';
}

/** The line under the time panel while a robot is held for dropping. */
export function placingLine(p: { name: string; team: number; flip: boolean; rot: Rotation; ok: boolean; reason?: string }): string {
  const how = `${teamName(p.team)}${p.flip ? ', flipped' : ''}${p.rot !== 0 ? `, turned ${p.rot}` : ''}`;
  const here = p.ok ? 'fits here' : `blocked: ${p.reason ?? 'move the cursor into the world'}`;
  // Whether it fits comes first: on a narrow window the end of the line is cut off.
  return `PLACING ${p.name} as ${how}: ${here}   click drops   Shift+click keeps placing   F flips   R turns   Esc or right click stops`;
}
