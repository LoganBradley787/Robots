import { World, parseWorldFile } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { drawDebug } from './render/DebugDraw';
import { toScreen } from './render/units';

async function boot(): Promise<void> {
  const file = parseWorldFile(flatJson);
  const world = await World.create({ seed: 1 }, file);
  world.spawnBox(file.spawn.x, file.spawn.y);

  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');
  const renderer = new Renderer();
  await renderer.init(root);

  const focus = toScreen({ x: file.spawn.x, y: file.spawn.y - 3 });
  renderer.world.pivot.set(focus.x, focus.y);

  renderer.app.ticker.add(() => {
    renderer.world.position.set(renderer.screenWidth / 2, renderer.screenHeight / 2);
    world.step();
    drawDebug(renderer.debug, world.physics.debugRender(), true);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
