import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  createCamera,
  followTarget,
  panByPixels,
  screenToWorld,
  setFollow,
  zoomBy,
} from '../src/render/camera';
import { PIXELS_PER_METER } from '../src/render/units';

describe('camera', () => {
  it('zoom clamps to the allowed range', () => {
    let cam = createCamera(0, 0);
    for (let i = 0; i < 50; i++) cam = zoomBy(cam, 1.5);
    expect(cam.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 50; i++) cam = zoomBy(cam, 0.5);
    expect(cam.zoom).toBe(ZOOM_MIN);
  });

  it('dragging right and down moves the camera left and up in world space, and stops following', () => {
    const cam = panByPixels(createCamera(0, 0), PIXELS_PER_METER, PIXELS_PER_METER);
    expect(cam.x).toBeCloseTo(-1, 9);
    expect(cam.y).toBeCloseTo(1, 9);
    expect(cam.follow).toBe(false);
  });

  it('pan distance scales with zoom', () => {
    const cam = panByPixels(zoomBy(createCamera(0, 0), 2), PIXELS_PER_METER, 0);
    expect(cam.x).toBeCloseTo(-0.5, 9);
  });

  it('follow converges on the target and does nothing when off', () => {
    let cam = createCamera(0, 0);
    for (let i = 0; i < 300; i++) cam = followTarget(cam, { x: 10, y: -2 }, 1 / 60);
    expect(cam.x).toBeCloseTo(10, 3);
    expect(cam.y).toBeCloseTo(-2, 3);
    const off = followTarget(setFollow(cam, false), { x: 0, y: 0 }, 1 / 60);
    expect(off.x).toBeCloseTo(cam.x, 9);
  });

  it('screenToWorld maps the screen center to the camera position', () => {
    const cam = createCamera(3, 4);
    expect(screenToWorld(cam, 400, 300, 800, 600)).toEqual({ x: 3, y: 4 });
    const right = screenToWorld(cam, 400 + PIXELS_PER_METER, 300, 800, 600);
    expect(right.x).toBeCloseTo(4, 9);
    const down = screenToWorld(cam, 400, 300 + PIXELS_PER_METER, 800, 600);
    expect(down.y).toBeCloseTo(3, 9);
  });
});
