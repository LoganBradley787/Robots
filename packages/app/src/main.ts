import { render, h } from 'preact';
import { Sprite } from 'pixi.js';
import { blankBlueprint, defaultRegistry, parseWorldFile, staticStats, type Blueprint } from '@robots/sim-core';
import './ui/styles.css';
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
import { DocumentController } from './builder/document';
import { ask, notify } from './ui/dialogs';
import type { BuilderActions } from './ui/BuilderUi';
import { deleteBlueprintFile, listBlueprints, loadBlueprintFile, saveBlueprintFile } from './storage/blueprintApi';

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
    doc: { name: blank.name, dirty: false, files: [] },
    icons: {},
  });
  const scene = new BuilderScene(renderer.builder, (f) => textures.part(f));
  const builder = new Builder(registry, scene, store, blank);

  const doc = new DocumentController({
    registry,
    api: { list: listBlueprints, load: loadBlueprintFile, save: saveBlueprintFile, remove: deleteBlueprintFile },
    getDraft: () => builder.draft,
    setDraft: (bp: Blueprint, opts) => (opts?.keepHistory ? builder.edit(() => bp) : builder.load(bp)),
    askUnsaved: async () => {
      const a = await ask(store, {
        title: 'Unsaved changes',
        message: `"${doc.state.name}" has changes that are not saved.`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard' },
          { label: 'Save', value: 'save', kind: 'primary' },
        ],
        cancelValue: 'cancel',
      });
      return a.value as 'save' | 'discard' | 'cancel';
    },
    askName: async (current) => {
      const a = await ask(store, {
        title: 'Save As',
        message: 'Saves a new blueprint. The one you opened stays as it was.',
        input: { value: current === 'untitled' ? '' : `${current} copy`, placeholder: 'name' },
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Save', value: 'ok', kind: 'primary' },
        ],
        cancelValue: 'cancel',
      });
      return a.value === 'ok' ? a.input : null;
    },
    confirm: async (message) => {
      const a = await ask(store, {
        title: 'Are you sure?',
        message,
        buttons: [
          { label: 'Cancel', value: 'no' },
          { label: 'Yes', value: 'yes', kind: 'danger' },
        ],
        cancelValue: 'no',
      });
      return a.value === 'yes';
    },
    notify: (m) => notify(store, m),
  });

  const syncDoc = async (refreshList: boolean): Promise<void> => {
    const files = refreshList ? await listBlueprints().catch(() => store.get().doc.files) : store.get().doc.files;
    store.set({ doc: { ...doc.state, dirty: doc.isDirty(), files } });
  };
  let lastDraft = builder.draft;
  store.subscribe(() => {
    const d = store.get().builder.draft;
    if (d === lastDraft) return;
    lastDraft = d;
    const dirty = doc.isDirty();
    if (dirty !== store.get().doc.dirty) store.set({ doc: { ...store.get().doc, dirty } });
  });
  const run = (p: Promise<unknown>): void => {
    p.then(() => syncDoc(true)).catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
  };

  const actions: BuilderActions = {
    hold: (part) => builder.dispatch({ type: 'hold', part }),
    open: (file) => run(doc.open(file)),
    newBlank: () => run(doc.newBlank()),
    save: () => run(doc.save()),
    saveAs: () => run(doc.saveAs()),
    remove: () => run(doc.remove()),
    deploy: () => notify(store, 'Deploy arrives in M2 T9.'),
    focusIssue: (issue) => {
      const part = issue.partId ? builder.draft.parts.find((p) => p.id === issue.partId) : undefined;
      const cell = issue.cell ?? (part ? { x: part.x, y: part.y } : undefined);
      if (part) builder.select([part.id]);
      if (cell) scene.cam = { ...scene.cam, x: cell.x, y: cell.y };
    },
  };
  void syncDoc(true);

  // Palette icons come from the same textures the canvas draws.
  const icons: Record<string, string> = {};
  for (const d of registry.list()) {
    icons[d.id] = await renderer.app.renderer.extract.base64({ target: new Sprite(textures.part(d.sprite.frame)) });
  }
  store.set({ icons });
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
    if (isTypingTarget(e.target) || store.get().dialog) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
      return;
    }
    if (modes.mode !== 'builder' || store.get().dialog) return;
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
      e.preventDefault();
      if (e.shiftKey) actions.saveAs();
      else actions.save();
      return;
    }
    if (builder.onKeyDown(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => builder.onKeyUp(e));
  bindKeys(window, worldScreen.keyActions(), () => modes.mode === 'world');

  // Buttons and dropdowns give focus back after use, so builder keys (and Space) never land on them.
  uiEl.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    const control = el?.closest('button');
    if (control && !control.closest('.dialog')) control.blur();
  });
  uiEl.addEventListener('change', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.tagName === 'SELECT') el.blur();
  });
  render(h(App, { store, defs: registry.list(), actions }), uiEl);

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
