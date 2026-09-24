import { render, h } from 'preact';
import { Sprite } from 'pixi.js';
import { addTagToParts, createQuickJsHost, setAutoControls, setBindings, setPartsAuto, blankBlueprint, defaultRegistry, parseWorldFile, removeTagFromParts, staticStats, toFileJson, type Blueprint } from '@robots/sim-core';
import './ui/styles.css';
import quickjsBrowser from '@jitl/quickjs-singlefile-browser-release-sync';
import { addScript, cleanScriptId, removeScript, renameScript, updateScript } from './builder/scripts';
import flatJson from '../../../worlds/flat.json';
import { Renderer } from './render/Renderer';
import { loadTextures } from './render/assets';
import { Hud } from './app/Hud';
import { bindKeys, codeOf, isTypingTarget, worldKeyLabel } from './app/keys';
import { keyName } from './builder/bindings';
import { enterWorld, toggleMode, type ModeState } from './app/modes';
import { deployDecision } from './builder/deployFlow';
import { WorldScreen } from './world/WorldScreen';
import { createStore } from './ui/store';
import type { AppState } from './ui/appState';
import { App } from './ui/App';
import { BuilderScene } from './builder/BuilderScene';
import { Builder } from './builder/Builder';
import { DocumentController } from './builder/document';
import { ask, notify } from './ui/dialogs';
import type { AppActions } from './ui/App';
import { deleteBlueprintFile, listBlueprints, loadBlueprintFile, loadScriptFile, replayFileName, saveBlueprintFile, saveReplayFile, saveScriptFile } from './storage/blueprintApi';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  const uiEl = document.getElementById('ui');
  if (!root || !hudEl || !uiEl) throw new Error('missing #app, #hud, or #ui');
  const renderer = new Renderer();
  await renderer.init(root);
  const textures = await loadTextures();
  const hud = new Hud(hudEl);
  // The script sandbox (QuickJS in WASM, the browser build of the same engine the CLI uses).
  const scriptHost = await createQuickJsHost(quickjsBrowser);
  const worldScreen = await WorldScreen.create(renderer, textures, parseWorldFile(flatJson), hud, scriptHost);

  const registry = defaultRegistry();
  const blank = blankBlueprint('untitled');
  const store = createStore<AppState>({
    mode: 'builder',
    builder: { draft: blank, eraser: false, selection: [], mirror: { on: false, axisHalfCells: 0, axisSet: false }, canUndo: false, canRedo: false, issues: [], stats: staticStats(blank, registry) },
    doc: { name: blank.name, dirty: false, files: [] },
    icons: {},
  });
  const scene = new BuilderScene(renderer.builder, (f) => textures.part(f));
  const builder = new Builder(registry, scene, store, blank);

  const doc = new DocumentController({
    registry,
    api: { list: listBlueprints, load: loadBlueprintFile, save: saveBlueprintFile, remove: deleteBlueprintFile, loadText: loadScriptFile, saveText: saveScriptFile },
    getDraft: () => builder.draft,
    setDraft: (bp: Blueprint, opts) => (opts?.keepHistory ? builder.edit(() => bp) : builder.load(bp)),
    renameHistory: (name) => builder.renameHistory(name),
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

  const worldKeys = worldScreen.keyActions();
  worldScreen.onView = (world) => store.set({ world });
  worldScreen.onNotice = (message) => notify(store, message);
  const actions: AppActions = {
    worldTogglePause: worldKeys.togglePause,
    worldStep: worldKeys.step,
    worldSlower: worldKeys.slower,
    worldFaster: worldKeys.faster,
    worldCamera: worldKeys.camera,
    worldHome: worldKeys.home,
    worldToggleDebug: worldKeys.toggleDebug,
    worldToggleGrid: worldKeys.toggleGrid,
    worldReset: () => {
      void ask(store, {
        title: 'Clear robots?',
        message: 'Removes every robot from the world. Your blueprints are not touched.',
        buttons: [
          { label: 'Cancel', value: 'no' },
          { label: 'Clear', value: 'yes', kind: 'danger' },
        ],
        cancelValue: 'no',
      }).then((a) => {
        if (a.value === 'yes') worldKeys.reset();
      });
    },
    toggleUnlimitedEnergy: () => worldScreen.toggleUnlimitedEnergy(),
    clearDebris: () => worldScreen.clearDebris(),
    saveReplay: () => {
      const { replay, robot } = worldScreen.replay();
      const file = replayFileName(new Date(), robot);
      saveReplayFile(file, replay)
        .then(() => notify(store, `Saved replays/${file}. Rerun it with: pnpm sim replay ${file.slice(0, -'.json'.length)}`))
        .catch((e: unknown) => notify(store, `Could not save the replay: ${e instanceof Error ? e.message : String(e)}`));
    },
    toBuilder: () => {
      worldScreen.cancelPlacing();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
    },
    setBindings: (bindings) => builder.edit((bp) => setBindings(bp, bindings)),
    addTag: (ids, tag) => builder.edit((bp) => addTagToParts(bp, ids, tag)),
    removeTag: (ids, tag) => builder.edit((bp) => removeTagFromParts(bp, ids, tag)),
    setAuto: (ids, on) => builder.edit((bp) => setPartsAuto(bp, ids, on)),
    setAutoControls: (on) => builder.edit((bp) => setAutoControls(bp, on)),
    closeMenu: () => builder.dispatch({ type: 'closeMenu' }),
    eraser: () => builder.dispatch({ type: 'eraser' }),
    addScript: () => {
      const r = addScript(builder.draft);
      builder.edit(() => r.bp);
      store.set({ scriptEditor: r.id });
    },
    removeScript: (id) => {
      void ask(store, {
        title: 'Remove script?',
        message: `Removes "${id}" and the keys that toggle it from this blueprint. Its file stays in blueprints/ until you delete it.`,
        buttons: [
          { label: 'Cancel', value: 'no' },
          { label: 'Remove', value: 'yes', kind: 'danger' },
        ],
        cancelValue: 'no',
      }).then((a) => {
        if (a.value !== 'yes') return;
        builder.edit((bp) => removeScript(bp, id));
        if (store.get().scriptEditor === id) store.set({ scriptEditor: undefined });
      });
    },
    renameScript: (from, to) => {
      builder.edit((bp) => renameScript(bp, from, to));
      const renamed = cleanScriptId(to);
      if (store.get().scriptEditor === from && builder.draft.scripts.some((x) => x.id === renamed)) store.set({ scriptEditor: renamed });
    },
    setScriptEnabled: (id, on) => builder.edit((bp) => updateScript(bp, id, { enabled: on })),
    openScript: (id) => store.set({ scriptEditor: id }),
    closeScript: () => store.set({ scriptEditor: undefined }),
    setScriptSource: (id, source) => builder.edit((bp) => updateScript(bp, id, { source })),
    setScriptParam: (id, name, value) =>
      builder.edit((bp) => {
        const s = bp.scripts.find((x) => x.id === id);
        if (!s) return bp;
        const params = { ...s.params };
        if (value === undefined) delete params[name];
        else params[name] = value;
        return updateScript(bp, id, { params });
      }),
    checkScript: (source, name) => {
      const r = scriptHost.compile(source, { name, seed: 0 });
      if (!r.ok) return r;
      const params = { ...r.instance.params };
      r.instance.dispose();
      return { ok: true, params };
    },
    beginTextEdit: () => builder.beginTextEdit(),
    endTextEdit: () => builder.endTextEdit(),
    robotKeyDown: (key) => worldScreen.keys.down('mouse', key),
    robotKeyUp: (key) => worldScreen.keys.up('mouse', key),
    rotate: (dir) => builder.dispatch({ type: 'rotate', dir }),
    deleteSelection: () => builder.dispatch({ type: 'deleteSelection' }),
    hold: (part) => builder.dispatch({ type: 'hold', part }),
    open: (file) => run(doc.open(file)),
    newBlank: () => run(doc.newBlank()),
    save: () => run(doc.save()),
    saveAs: () => run(doc.saveAs()),
    remove: () => run(doc.remove()),
    deploy: () => {
      const go = async (): Promise<void> => {
        const d = deployDecision(store.get().builder.issues, doc.isDirty());
        if (d.step === 'blocked') {
          notify(store, `Fix ${d.errors} error${d.errors === 1 ? '' : 's'} before deploying (see Issues).`);
          return;
        }
        if (d.step === 'confirm-unsaved' && !(await doc.confirmLeave())) return;
        await syncDoc(true);
        setMode(enterWorld({ ...modes, paused: worldScreen.time.paused }));
        // Deploy carries script code inline, so the spawn log and replays never depend on files.
        worldScreen.startPlacing(toFileJson(builder.draft, registry, { inlineScripts: true }), registry);
      };
      go().catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
    },
    focusIssue: (issue) => {
      const part = issue.partId ? builder.draft.parts.find((p) => p.id === issue.partId) : undefined;
      const cell = issue.cell ?? (part ? { x: part.x, y: part.y } : undefined);
      if (part) builder.select([part.id]);
      if (cell) scene.cam = { ...scene.cam, x: cell.x, y: cell.y };
    },
  };
  void syncDoc(true);
  // Closing or reloading the tab with unsaved changes gets the browser's own "leave page?" prompt.
  window.addEventListener('beforeunload', (e) => {
    if (doc.isDirty()) e.preventDefault();
  });

  // Palette icons come from the same textures the canvas draws.
  const icons: Record<string, string> = {};
  for (const d of registry.list()) {
    icons[d.id] = await renderer.app.renderer.extract.base64({ target: new Sprite(textures.part(d.sprite.frame)) });
  }
  store.set({ icons });
  let modes: ModeState = { mode: 'world', paused: false, pausedBeforeBuilder: false };
  const setMode = (next: ModeState): void => {
    // Leaving the world releases the controlled robot's keys, so none sticks down while you are away (`11`).
    if (next.mode === 'builder') worldScreen.keys.releaseAll();
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
  const local = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (modes.mode === 'world') worldScreen.onPointerDown(e, ...local(e));
    else builder.onPointerDown(e, cellOf(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (modes.mode === 'world') worldScreen.onPointerMove(e, ...local(e));
    else builder.onPointerMove(e, cellOf(e));
  });
  const up = (e: PointerEvent): void => {
    if (modes.mode === 'world') worldScreen.onPointerUp(e, ...local(e));
    else builder.onPointerUp(e, cellOf(e));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  window.addEventListener('keydown', (e) => {
    // Cmd+S never opens the browser's Save Page dialog; in the builder it saves, even from a text field.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
      e.preventDefault();
      if (modes.mode === 'builder' && !store.get().dialog) {
        if (e.shiftKey) actions.saveAs();
        else actions.save();
      }
      return;
    }
    // macOS sends no keyup for a key let go while Cmd is down, so a Cmd chord lets go of the robot's keys.
    if (e.key === 'Meta') worldScreen.keys.releaseAll();
    if (isTypingTarget(e.target) || store.get().dialog) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      worldScreen.cancelPlacing();
      builder.endGesture();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
      return;
    }
    if (modes.mode === 'world' && e.code === 'Escape' && worldScreen.isPlacing) {
      worldScreen.cancelPlacing();
      return;
    }
    if (modes.mode === 'world') {
      // Every key that is not a world key belongs to the controlled robot (Gate 2).
      const code = codeOf(e);
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || code === '' || worldKeyLabel(code) !== undefined) return;
      if (worldScreen.controlledId !== undefined) e.preventDefault();
      worldScreen.keys.down('keyboard', keyName({ code }));
      return;
    }
    if (builder.onKeyDown(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const code = codeOf(e);
    if (code !== '') worldScreen.keys.up('keyboard', keyName({ code }));
    builder.onKeyUp(e);
  });
  window.addEventListener('blur', () => {
    builder.endGesture();
    worldScreen.keys.releaseAll();
  });
  bindKeys(window, worldKeys, () => modes.mode === 'world' && !store.get().dialog);

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
  render(h(App, { store, registry, actions }), uiEl);

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
