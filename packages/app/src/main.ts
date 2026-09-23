import { render, h } from 'preact';
import { parseWorldFile } from '@robots/sim-core';
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

  const store = createStore<AppState>({ mode: 'builder' });
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
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (modes.mode === 'world') worldScreen.onWheel(e);
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (modes.mode === 'world') worldScreen.onPointerDown(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (modes.mode === 'world') worldScreen.onPointerMove(e);
  });
  const up = (e: PointerEvent): void => {
    if (modes.mode === 'world') worldScreen.onPointerUp(e);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || isTypingTarget(e.target)) return;
    e.preventDefault();
    setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
  });
  bindKeys(window, worldScreen.keyActions(), () => modes.mode === 'world');

  render(h(App, { store }), uiEl);

  renderer.app.ticker.add((ticker) => {
    if (modes.mode === 'world') worldScreen.frame(ticker);
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
