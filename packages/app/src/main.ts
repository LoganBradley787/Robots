import { render, h } from 'preact';
import { blankBlueprint, defaultRegistry, parseWorldFile, staticStats } from '@robots/sim-core';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { loadTextures } from './render/assets';
import { Hud } from './app/Hud';
import { bindKeys, isTypingTarget } from './app/keys';
import { toggleMode, type ModeState } from './app/modes';
import { WorldScreen } from './world/WorldScreen';
import { createStore } from './ui/store';
import type { AppState } from './ui/appState';
import { App } from './ui/App';
import { BuilderScene } from './builder/BuilderScene';
import { Builder } from './builder/Builder';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  const uiEl = document.getElementById('ui');
  if (!root || !hudEl || !uiEl) throw new Error('missing #app, #hud, or #ui');
  const renderer = new Renderer();
  await renderer.init(root);
  const textures = await loadTextures();
  const hud = new Hud(hudEl);
  const worldScreen = await WorldScreen.create(renderer, textures, parseWorldFile(flatJson), hud);

  const registry = defaultRegistry();
  const blank = blankBlueprint('untitled');
  const store = createStore<AppState>({
    mode: 'builder',
    builder: { draft: blank, selection: [], mirror: { on: false, axisHalfCells: 0 }, canUndo: false, canRedo: false, issues: [], stats: staticStats(blank, registry) },
  });
  const scene = new BuilderScene(renderer.builder, (f) => textures.part(f));
  const builder = new Builder(registry, scene, store, blank);
  let modes: ModeState = { mode: 'world', paused: false, pausedBeforeBuilder: false };
  const setMode = (next: ModeState): void => {
    modes = next;
    worldScreen.setPaused(next.paused);
    renderer.showScene(next.mode);
    hudEl.style.display = next.mode === 'world' ? '' : 'none';
    store.set({ mode: next.mode });
  };
  setMode(toggleMode(modes)); // the app opens in the builder

  const canvas = renderer.app.canvas;
  const cellOf = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return scene.cellAt(e.clientX - r.left, e.clientY - r.top, renderer.screenWidth, renderer.screenHeight);
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (modes.mode === 'world') worldScreen.onWheel(e);
      else builder.onWheel(e);
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (modes.mode === 'world') worldScreen.onPointerDown(e);
    else builder.onPointerDown(e, cellOf(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (modes.mode === 'world') worldScreen.onPointerMove(e);
    else builder.onPointerMove(e, cellOf(e));
  });
  const up = (e: PointerEvent): void => {
    if (modes.mode === 'world') worldScreen.onPointerUp(e);
    else builder.onPointerUp(e, cellOf(e));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
      return;
    }
    if (modes.mode === 'builder' && builder.onKeyDown(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => builder.onKeyUp(e));
  bindKeys(window, worldScreen.keyActions(), () => modes.mode === 'world');

  render(h(App, { store }), uiEl);

  renderer.app.ticker.add((ticker) => {
    if (modes.mode === 'world') worldScreen.frame(ticker);
    else builder.frame(renderer.screenWidth, renderer.screenHeight);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
