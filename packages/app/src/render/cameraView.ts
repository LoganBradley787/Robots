import type { Container } from 'pixi.js';
import type { CameraState } from './camera';
import { toScreen } from './units';

/** Zoom about the screen center: pivot at the camera's world point, position at the center, scale by zoom. */
export function applyCamera(container: Container, cam: CameraState, screenW: number, screenH: number): void {
  const p = toScreen(cam);
  container.pivot.set(p.x, p.y);
  container.position.set(screenW / 2, screenH / 2);
  container.scale.set(cam.zoom);
}
