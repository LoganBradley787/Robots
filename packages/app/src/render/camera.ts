import { PIXELS_PER_METER, type Vec2 } from './units';

export interface CameraState {
  /** World position (meters) at the center of the screen. */
  x: number;
  y: number;
  zoom: number;
  follow: boolean;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export function createCamera(x: number, y: number): CameraState {
  return { x, y, zoom: 1, follow: true };
}

/** Exponential smoothing toward the target; frame-rate independent. */
export function followTarget(cam: CameraState, target: Vec2, dtSeconds: number, stiffness = 6): CameraState {
  if (!cam.follow) return cam;
  const k = 1 - Math.exp(-stiffness * dtSeconds);
  return { ...cam, x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k };
}

export function zoomBy(cam: CameraState, factor: number): CameraState {
  return { ...cam, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor)) };
}

/** Drag by screen pixels: the world moves with the pointer, so the camera moves the other way. */
export function panByPixels(cam: CameraState, dxPx: number, dyPx: number): CameraState {
  const s = cam.zoom * PIXELS_PER_METER;
  return { ...cam, follow: false, x: cam.x - dxPx / s, y: cam.y + dyPx / s };
}

export function setFollow(cam: CameraState, follow: boolean): CameraState {
  return { ...cam, follow };
}

export function screenToWorld(cam: CameraState, sx: number, sy: number, screenW: number, screenH: number): Vec2 {
  const s = cam.zoom * PIXELS_PER_METER;
  return { x: cam.x + (sx - screenW / 2) / s, y: cam.y - (sy - screenH / 2) / s };
}
