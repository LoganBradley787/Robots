import { World, parseWorldFile, sampleRobot, type Robot } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import carJson from '../../../blueprints/car.json';
import showcaseJson from '../../../blueprints/showcase.json';
import { Renderer } from './render/Renderer';
import { drawDebug } from './render/DebugDraw';
import { interpolateState } from './render/interpolate';
import { loadTextures } from './render/assets';
import { RobotView } from './render/RobotView';
import { buildTerrainView } from './render/TerrainView';
import { buildGridView } from './render/GridView';
import { TERRAIN } from './render/assetKeys';
import { createCamera, followTarget, panByPixels, setFollow, zoomBy } from './render/camera';
import { applyCamera } from './render/cameraView';
import { FixedStepper } from './app/FixedStepper';
import { TimeControls } from './app/TimeControls';
import { Hud } from './app/Hud';
import { bindKeys } from './app/keys';

const HELP = 'Space pause   . step   [ ] speed   F follow   C next robot   D debug   G grid   R reset   wheel zoom   drag pan';

/** Interpolated world position of the robot's core (or root part), for the camera. */
function anchorPosition(world: World, robot: Robot, alpha: number): { x: number; y: number } {
  const part = robot.parts.get(robot.primaryCoreId ?? robot.rootId);
  const group = part ? robot.groups[part.group] : undefined;
  if (!part || !group) return { x: robot.spawnX, y: robot.spawnY };
  const s = interpolateState(world.physics.prevState(group.bodyId), world.physics.state(group.bodyId), alpha);
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.x + c * part.localX - n * part.localY, y: s.y + n * part.localX + c * part.localY };
}

async function boot(): Promise<void> {
  const file = parseWorldFile(flatJson);
  const world = await World.create({ seed: 1 }, file);
  world.spawnBlueprint(carJson, file.spawn);
  // Left of the car, where the flat world has clear ground (a box sits at x 8 and the ramp at x 12 to 18).
  world.spawnBlueprint(showcaseJson, { x: file.spawn.x - 13, y: file.spawn.y });

  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  if (!root || !hudEl) throw new Error('missing #app or #hud');
  const renderer = new Renderer();
  await renderer.init(root);
  const textures = await loadTextures();
  const hud = new Hud(hudEl);

  const grid = buildGridView({ minX: -60, maxX: 60, minY: -2, maxY: 30 });
  renderer.backdrop.addChild(
    grid,
    buildTerrainView(file, {
      ground: textures.alias(TERRAIN.ground),
      groundTop: textures.alias(TERRAIN.groundTop),
      block: textures.alias(TERRAIN.block),
    }),
  );

  const views = world.robots.map((r) => new RobotView(r, (f) => textures.part(f)));
  for (const v of views) renderer.bodies.addChild(v.root);

  let targetIndex = 0;
  const target = (): Robot => world.robots[targetIndex] ?? (world.robots[0] as Robot);
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
  let debugVisible = false;
  let lastHash = world.hash();

  bindKeys(window, {
    togglePause: () => {
      time.togglePause();
      if (!time.paused) stepper.resume();
    },
    step: () => time.requestStep(),
    faster: () => time.faster(),
    slower: () => time.slower(),
    toggleDebug: () => {
      debugVisible = !debugVisible;
    },
    toggleFollow: () => {
      cam = setFollow(cam, !cam.follow);
    },
    cycleTarget: () => {
      targetIndex = (targetIndex + 1) % world.robots.length;
      cam = setFollow(cam, true);
    },
    toggleGrid: () => {
      grid.visible = !grid.visible;
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
    for (const v of views) v.sync(world.physics, alpha);
    cam = followTarget(cam, anchorPosition(world, target(), alpha), ticker.deltaMS / 1000);
    applyCamera(renderer.world, cam, renderer.screenWidth, renderer.screenHeight);
    if (debugVisible) drawDebug(renderer.debug, world.physics.debugRender(), true);
    else renderer.debug.clear();

    const s = sampleRobot(world, target());
    hud.set([
      `tick ${world.tick}   t=${world.time.toFixed(2)}s   ${Math.round(ticker.FPS)} fps`,
      `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}   zoom ${cam.zoom.toFixed(2)}   follow ${cam.follow ? 'on' : 'off'}`,
      `robot ${target().name} (${targetIndex + 1}/${world.robots.length})   core (${s.coreX.toFixed(2)}, ${s.coreY.toFixed(2)})   tilt ${s.tiltDeg.toFixed(1)}   ${s.resting ? 'resting' : 'moving'}   ${s.massKg.toFixed(1)} kg`,
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
