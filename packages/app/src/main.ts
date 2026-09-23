import { World, parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { drawDebug } from './render/DebugDraw';
import { BoxView } from './render/BoxView';
import { interpolateState } from './render/interpolate';
import { createCamera, followTarget, panByPixels, setFollow, zoomBy } from './render/camera';
import { applyCamera } from './render/cameraView';
import { FixedStepper } from './app/FixedStepper';
import { TimeControls } from './app/TimeControls';
import { Hud } from './app/Hud';
import { bindKeys } from './app/keys';

const HELP = 'Space pause   . step   [ ] speed   D debug   F follow   R reset';

async function boot(): Promise<void> {
  const file = parseWorldFile(flatJson);
  const world = await World.create({ seed: 1 }, file);
  const box = world.spawnBox(file.spawn.x, file.spawn.y);

  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  if (!root || !hudEl) throw new Error('missing #app or #hud');
  const renderer = new Renderer();
  await renderer.init(root);
  const hud = new Hud(hudEl);

  const boxView = new BoxView(1, 1, 0x4c8dff);
  renderer.world.addChild(boxView.gfx);

  let cam = createCamera(file.spawn.x, file.spawn.y - 3);

  const canvas = renderer.app.canvas;
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam = zoomBy(cam, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  let dragging: { id: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    cam = panByPixels(cam, e.clientX - dragging.x, e.clientY - dragging.y);
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const stepper = new FixedStepper(1000 * world.dt);
  const time = new TimeControls();
  let debugVisible = true;
  let lastHash = world.hash();

  bindKeys(window, {
    togglePause: () => time.togglePause(),
    step: () => time.requestStep(),
    faster: () => time.faster(),
    slower: () => time.slower(),
    toggleDebug: () => {
      debugVisible = !debugVisible;
    },
    toggleFollow: () => {
      cam = setFollow(cam, !cam.follow);
    },
    reset: () => location.reload(),
  });

  renderer.app.ticker.add((ticker) => {
    let ticks = time.takePendingSteps();
    if (time.paused) stepper.reset();
    else ticks += stepper.advance(ticker.deltaMS, time.timeScale);
    for (let i = 0; i < ticks; i++) {
      world.step();
      if (world.tick % 60 === 0) lastHash = world.hash();
    }

    const alpha = time.paused ? 1 : stepper.alpha;
    const boxState = interpolateState(world.physics.prevState(box), world.physics.state(box), alpha);
    boxView.sync(boxState);
    cam = followTarget(cam, boxState, ticker.deltaMS / 1000);
    applyCamera(renderer.world, cam, renderer.screenWidth, renderer.screenHeight);
    drawDebug(renderer.debug, world.physics.debugRender(), debugVisible);

    hud.set([
      `tick ${world.tick}   t=${world.time.toFixed(2)}s   ${Math.round(ticker.FPS)} fps`,
      `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}   zoom ${cam.zoom.toFixed(2)}   follow ${cam.follow ? 'on' : 'off'}`,
      `hash ${lastHash}`,
      HELP,
    ]);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
