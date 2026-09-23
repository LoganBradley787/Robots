// The single place where physics meters (y up) become screen pixels (y down). Nothing else flips signs.
export const METERS_PER_CELL = 1;
export const PIXELS_PER_METER = 32;

export interface Vec2 {
  x: number;
  y: number;
}

export function toScreen(m: Vec2): Vec2 {
  return { x: m.x * PIXELS_PER_METER, y: -m.y * PIXELS_PER_METER };
}

export function toWorld(px: Vec2): Vec2 {
  return { x: px.x / PIXELS_PER_METER, y: -px.y / PIXELS_PER_METER };
}

export function toScreenAngle(a: number): number {
  return -a;
}
