import { faceDir, rotateFace, rotationRadians, type BodyId, type Robot } from '@robots/sim-core';
import { partSprites, type PartSprite } from './partSprites';

export interface SpriteLayout {
  /** `mount` sprites belong to a joint part but are drawn on its parent body (the wheel's axle bracket). */
  kind: 'part' | 'mount';
  partId: string;
  frame: string;
  /** Offset from the body origin in meters, and rotation in radians (CCW), both in the body frame. */
  x: number;
  y: number;
  rotation: number;
  /** Size in cells before rotation: a multi-cell part's sprite spans its footprint (M12). 1 by 1 for the rest. */
  w: number;
  h: number;
  /** Mirrored left to right in the part's frame (a stretchy cup's right side, M12). */
  flip?: boolean;
  /** Looping fx animation that replaces the frame while the part acts (propeller spin). */
  animation?: string;
  /**
   * Fx overlay shown while the part acts (thruster flame), anchored at the part's nozzle edge (opposite the way it
   * acts), in the body frame. The overlay texture's top edge sits on the anchor and it extends away from the part.
   */
  overlay?: { name: string; x: number; y: number };
  /** The input channel whose value (0 to its max) drives the effect. */
  channel?: string;
}

export interface BodyLayout {
  group: number;
  bodyId: BodyId;
  sprites: SpriteLayout[];
}

/** Pure description of what to draw for each body of a robot, in draw order (joint bodies first). */
export function layoutRobot(robot: Robot): BodyLayout[] {
  const bodies: BodyLayout[] = robot.groups.map((g) => ({ group: g.index, bodyId: g.bodyId, sprites: [] }));
  for (const g of robot.groups) {
    const body = bodies[g.index];
    if (!body) continue;
    for (const id of g.partIds) {
      const p = robot.parts.get(id);
      if (!p) continue;
      // A multi-cell part spans its footprint's box, turned with the part; a stretchy cup is tiles, one per cell (M12).
      const tiles = partSprites(p.def, p.rot, p.footprint ?? p.def.footprint);
      for (const t of tiles.slice(0, -1)) {
        body.sprites.push({ kind: 'part', partId: id, frame: t.frame, x: p.localX + t.x, y: p.localY + t.y, rotation: rotationRadians(p.rot), w: t.w, h: t.h, ...(t.flip ? { flip: true } : {}) });
      }
      const last = tiles[tiles.length - 1] as PartSprite;
      const sprite: SpriteLayout = { kind: 'part', partId: id, frame: last.frame, x: p.localX + last.x, y: p.localY + last.y, rotation: rotationRadians(p.rot), w: last.w, h: last.h, ...(last.flip ? { flip: true } : {}) };
      const channel = p.def.inputs[0]?.name;
      if (channel !== undefined && (p.def.sprite.animation !== undefined || p.def.sprite.overlay !== undefined)) sprite.channel = channel;
      if (p.def.sprite.animation !== undefined) sprite.animation = p.def.sprite.animation;
      if (p.def.sprite.overlay !== undefined) {
        const acts = faceDir(rotateFace(p.def.acts ?? 'N', p.rot));
        sprite.overlay = { name: p.def.sprite.overlay, x: p.localX - 0.5 * acts.x, y: p.localY - 0.5 * acts.y };
      }
      body.sprites.push(sprite);
    }
  }
  for (const g of robot.groups) {
    const j = g.joint;
    const p = j ? robot.parts.get(j.partId) : undefined;
    const parent = j ? bodies[j.parentGroup] : undefined;
    if (!j || !p || !parent || p.def.sprite.mountFrame === undefined) continue;
    parent.sprites.push({ kind: 'mount', partId: p.id, frame: p.def.sprite.mountFrame, x: j.anchorParentX, y: j.anchorParentY, rotation: rotationRadians(p.rot), w: 1, h: 1 });
  }
  const jointFirst = (b: BodyLayout): number => (robot.groups[b.group]?.joint ? 0 : 1);
  return [...bodies].sort((a, b) => jointFirst(a) - jointFirst(b) || a.group - b.group);
}
