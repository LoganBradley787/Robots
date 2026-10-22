import { render, h } from 'preact';
import { Sprite, UPDATE_PRIORITY } from 'pixi.js';
import { addTagToParts, allScripts, createQuickJsHost, expandBlueprint, inArena, MATCH_ARENA, orientRaw, partWorldPose, setPartsAuto, setPartsArmed, setPartsMakes, setPartsSize, blankBlueprint, defaultRegistry, parseWorldFile, removeTagFromParts, staticStats, toFileJson, type Binding, type Blueprint, type ScriptSpec } from '@robots/sim-core';
import './ui/styles.css';
import quickjsBrowser from '@jitl/quickjs-singlefile-browser-release-sync';
import { addScript, cleanScriptId, renameScript, updateScript } from './builder/scripts';
import { controlsOf, withControls } from './builder/coreControls';
import flatJson from '../../../worlds/flat.json';
import arenaJson from '../../../worlds/arena.json';
import { Renderer } from './render/Renderer';
import { loadTextures } from './render/assets';
import { Hud } from './app/Hud';
import { claimAuto } from './builder/keys';
import { bindKeys, codeOf, isTypingTarget, worldKeyLabel } from './app/keys';
import { keyName } from './builder/bindings';
import { enterWorld, toggleMode, type ModeState } from './app/modes';
import { deployDecision, testChoice } from './builder/deployFlow';
import { applyUpdate, behaviorCards, clearableGroups, readShelf, removeBehavior, setScriptKey, startChange, startFill } from './builder/shelf';
import type { CameraState } from './render/camera';
import { WorldScreen } from './world/WorldScreen';
import { mountSoundboard } from './audio/Soundboard';
import { BATTLE_GRID, HOVER_GRID } from './world/stress';
import { robotsText } from './world/removal';
import { teamName } from './world/deploySettings';
import { timedHost } from './app/timedHost';
import { createStore } from './ui/store';
import type { AppState } from './ui/appState';
import { App } from './ui/App';
import { BuilderScene } from './builder/BuilderScene';
import { applyLayout, BOARD_INSETS, scriptViewWidth } from './ui/layout';
import { HOTBAR_KEY, pushRecent, readHotbar, readRecent, RECENT_KEY, setSlot, swapSlots, type Hotbar } from './builder/hotbar';
import { cleanKind } from './builder/library';
import { robotThumbnail } from './render/partDraw';
import { Builder } from './builder/Builder';
import { handFull } from './builder/editorState';
import { DocumentController } from './builder/document';
import { ask, notify } from './ui/dialogs';
import type { AppActions } from './ui/App';
import { deleteBlueprintFile, listBlueprints, loadBlueprintFile, loadScriptFile, loadShelfFiles, replayFileName, saveBlueprintFile, saveReplayFile, saveScriptFile, setBlueprintKind } from './storage/blueprintApi';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  const uiEl = document.getElementById('ui');
  if (!root || !hudEl || !uiEl) throw new Error('missing #app, #hud, or #ui');
  // `?soundboard` (M15): every sound on a button, instead of the game.
  if (new URLSearchParams(window.location.search).has('soundboard')) {
    mountSoundboard(uiEl);
    return;
  }
  const renderer = new Renderer();
  await renderer.init(root);
  const textures = await loadTextures();
  const hud = new Hud(hudEl);
  // The script sandbox (QuickJS in WASM, the browser build of the same engine the CLI uses).
  // Wrapped in a timer (M9) for the debug overlay's perf readout; the sim never sees the clock.
  const { host: scriptHost, clock: scriptClock } = timedHost(await createQuickJsHost(quickjsBrowser));
  // `?duel=a,b` (the titans tournament): the two blueprints fight on the arena (the flat world without its boxes), as
  // `pnpm sim duel` sets them up. `&ya=` and `&yb=` are their cores' heights (resting on the ground when left out),
  // `&xa=` and `&xb=` their x (-400 and 400 when left out).
  const query = new URLSearchParams(window.location.search);
  const duel = (query.get('duel') ?? '').split(',').map((n) => n.trim()).filter((n) => n !== '');
  // A duel's scripts read the same edge as `pnpm sim duel` gives them (the global `arena`); a plain sandbox has none.
  const worldScreen = await WorldScreen.create(renderer, textures, parseWorldFile(duel.length === 2 ? arenaJson : flatJson), hud, scriptHost, scriptClock, duel.length === 2 ? MATCH_ARENA : null);

  const registry = defaultRegistry();
  // The hotbar and the recent row live in the browser (M16). A browser with storage switched off just forgets them.
  const remembered = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const remember = (key: string, value: unknown): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // not kept: nothing else to do
    }
  };
  const blank: Blueprint = { ...blankBlueprint('untitled'), kind: 'yours' };
  const store = createStore<AppState>({
    mode: 'builder',
    builder: { draft: blank, eraser: false, selection: [], scriptProblems: [], mirror: { on: false, axisHalfCells: 0, axisSet: false }, canUndo: false, canRedo: false, issues: [], stats: staticStats(blank, registry), controls: { bindings: [], scripts: [], autoOn: true }, cores: [{ label: 'main core' }], partFocus: 0 },
    doc: { name: blank.name, dirty: false, files: [] },
    icons: {},
    panel: { tab: 'robot', drawer: 'parts', problemsOpen: true },
    hotbar: readHotbar(remembered(HOTBAR_KEY), registry.ids()),
    recent: readRecent(remembered(RECENT_KEY), registry.ids()),
    meta: {},
    shelf: { entries: [], loaded: false },
  });
  applyLayout(uiEl);
  const scene = new BuilderScene(renderer.builder, (f) => textures.part(f), BOARD_INSETS);
  const builder = new Builder(registry, scene, store, blank);
  scene.show(blank, registry, { w: renderer.screenWidth, h: renderer.screenHeight });
  builder.setHotbar(store.get().hotbar);
  // For driving the builder from a test browser (dev server only): where a cell is on screen, and what the state is.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)['__robots'] = { builder, scene, store, worldScreen, pointOf: (x: number, y: number) => scene.pointOf({ x: x - 0.5, y: y - 0.5 }, renderer.screenWidth, renderer.screenHeight) };
  builder.origin = () => {
    const r = renderer.app.canvas.getBoundingClientRect();
    return { x: r.left, y: r.top };
  };
  builder.onHold = (part) => {
    const recent = pushRecent(store.get().recent, part);
    if (recent === store.get().recent) return;
    store.set({ recent });
    remember(RECENT_KEY, recent);
  };
  const setHotbar = (hotbar: Hotbar): void => {
    if (hotbar === store.get().hotbar) return;
    store.set({ hotbar });
    builder.setHotbar(hotbar);
    remember(HOTBAR_KEY, hotbar);
  };
  // Pictures of saved robots for the library and the Assemblies tab, drawn one at a time as they are asked for.
  const metaQueue: string[] = [];
  let metaBusy = false;
  const pumpMeta = async (): Promise<void> => {
    if (metaBusy) return;
    metaBusy = true;
    try {
      for (let file = metaQueue.shift(); file !== undefined; file = metaQueue.shift()) {
        let entry: AppState['meta'][string] = { parts: -1, scripts: 0 };
        try {
          const { blueprint } = expandBlueprint(await loadBlueprintFile(file));
          if (blueprint) {
            const thumb = await robotThumbnail(renderer.app.renderer, (f) => textures.part(f), blueprint, registry, 232, 124);
            entry = { parts: blueprint.parts.length, scripts: allScripts(blueprint).length, ...(thumb !== undefined ? { thumb } : {}) };
          }
        } catch {
          // a file that cannot be read keeps its card, with no picture
        }
        const done = file;
        store.set((s) => ({ meta: { ...s.meta, [done]: entry } }));
      }
    } finally {
      metaBusy = false;
    }
  };
  /** A file that was written or removed gets a new picture the next time it is asked for. */
  const forgetMeta = (file: string | undefined): void => {
    if (file === undefined || !(file in store.get().meta)) return;
    const { [file]: _gone, ...meta } = store.get().meta;
    store.set({ meta });
  };

  const doc = new DocumentController({
    registry,
    api: { list: listBlueprints, load: loadBlueprintFile, save: saveBlueprintFile, remove: deleteBlueprintFile, loadText: loadScriptFile, saveText: saveScriptFile },
    getDraft: () => builder.draft,
    setDraft: (bp: Blueprint, opts) => {
      if (opts?.keepHistory) return builder.edit(() => bp);
      // Another robot: the script view was about the last one. It closes first, so the board is whole when the robot is shown.
      store.set({ scriptEditor: undefined, scriptLine: undefined, behaviorUpdate: undefined, testBox: undefined });
      builder.load(bp);
    },
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
    // The name follows the draft (a rename, or an undo of one), so the top strip and the file's messages agree with it.
    if (d.name !== doc.state.name) doc.state = { ...doc.state, name: d.name };
    const dirty = doc.isDirty();
    const shown = store.get().doc;
    if (dirty !== shown.dirty || d.name !== shown.name) store.set({ doc: { ...shown, name: d.name, dirty } });
  });
  const run = (p: Promise<unknown>): void => {
    const before = doc.state.file;
    p.then(() => {
      forgetMeta(before);
      forgetMeta(doc.state.file);
      return syncDoc(true);
    }).catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
  };

  /**
   * The script view (M16) lies over the drawer and the left of the board. While it is open the board that is left is
   * the strip beside the inspector: the robot is shown whole in it, and Done puts the view back where it was.
   */
  let viewBefore: CameraState | undefined;
  let scriptViewOpen = false;
  const layoutScriptView = (): void => {
    const open = store.get().scriptEditor !== undefined;
    const w = scriptViewWidth(window.innerWidth);
    uiEl.style.setProperty('--sv-w', `${w}px`);
    if (open) {
      if (!scriptViewOpen) viewBefore = { ...scene.cam };
      builder.setBoardInsets({ ...BOARD_INSETS, left: w }, !scriptViewOpen);
    } else if (scriptViewOpen) {
      scene.setInsets(BOARD_INSETS);
      if (viewBefore) scene.cam = viewBefore;
      viewBefore = undefined;
      builder.setBoardInsets(BOARD_INSETS, false);
    }
    scriptViewOpen = open;
  };
  let lastEditor = store.get().scriptEditor;
  store.subscribe(() => {
    const now = store.get().scriptEditor;
    if (now === lastEditor) return;
    const was = lastEditor;
    lastEditor = now;
    if ((now === undefined) !== (was === undefined)) layoutScriptView();
  });
  window.addEventListener('resize', () => {
    if (scriptViewOpen) layoutScriptView();
  });
  // A part clicked on the board while the script view is open: its name goes into the code.
  let insertSeq = 0;
  builder.onPartClick = (id) => {
    if (store.get().scriptEditor === undefined) return false;
    store.set({ scriptInsert: { text: id, seq: ++insertSeq } });
    return true;
  };
  builder.onFilled = () => store.set((s) => ({ panel: { ...s.panel, tab: 'behaviors' } }));
  let shelfBusy = false;
  const loadShelf = (): void => {
    if (shelfBusy) return;
    shelfBusy = true;
    loadShelfFiles()
      .then((files) => {
        const entries = readShelf(files);
        // The same shelf again changes nothing (the panels compare it by identity).
        const had = store.get().shelf;
        if (had.loaded && had.error === undefined && JSON.stringify(had.entries.map((e) => e.source)) === JSON.stringify(entries.map((e) => e.source))) return;
        store.set({ shelf: { entries, loaded: true } });
      })
      .catch((e: unknown) => store.set((st) => ({ shelf: { entries: st.shelf.entries, loaded: st.shelf.loaded, error: e instanceof Error ? e.message : String(e) } })))
      .finally(() => {
        shelfBusy = false;
      });
  };
  /** Into the world with the robot as it is on screen in hand. Deploy carries script code inline, so the spawn log and replays never depend on files. */
  const startTest = async (): Promise<void> => {
    await syncDoc(true);
    setMode(enterWorld({ ...modes, paused: worldScreen.time.paused }));
    worldScreen.startPlacing(toFileJson(builder.draft, registry, { inlineScripts: true }), registry);
  };

  const worldKeys = worldScreen.keyActions();
  worldScreen.onView = (world) => store.set({ world });
  worldScreen.onClock = (clock) => store.set({ clock });
  worldScreen.onNotice = (message) => notify(store, message);
  /**
   * An edit to the controls of the core the panels are on (M7: the main core's are the blueprint's top level, another
   * core's its `cores` entry), as one undo step. Nothing is committed when nothing changed.
   */
  type Controls = { bindings: readonly Binding[]; scripts: readonly ScriptSpec[] };
  const editControls = (fn: (c: Controls) => Controls): void =>
    builder.edit((bp) => {
      const before = controlsOf(bp, registry, builder.controlsFor);
      const after = fn({ bindings: before.bindings, scripts: before.scripts });
      if (after.bindings === before.bindings && after.scripts === before.scripts) return bp;
      return withControls(bp, registry, builder.controlsFor, after);
    });
  let scriptLineSeq = 0;
  const actions: AppActions = {
    worldTogglePause: worldKeys.togglePause,
    worldStep: worldKeys.step,
    worldSetSpeed: (index) => worldScreen.setSpeed(index),
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
    toggleSmooth: () => worldScreen.toggleSmooth(),
    toggleNoSmokeOrJam: () => worldScreen.toggleNoSmokeOrJam(),
    toggleDeployTeam: () => worldScreen.toggleDeployTeam(),
    toggleMute: () => worldScreen.sound.set({ muted: !worldScreen.sound.settings.muted }),
    setVolume: (volume) => worldScreen.sound.set({ volume }),
    toggleSoundDelay: () => worldScreen.sound.set({ delay: !worldScreen.sound.settings.delay }),
    stress: (kind, n) => {
      // Shipped blueprints, loaded like the Blueprints palette does. Hover: every script on, so they hold their height.
      // In the file form the world takes (as the deploy ghost passes it), facing as given.
      const load = async (file: string, scriptsOn: boolean, flip = false): Promise<unknown> => {
        const bp = await doc.loadForPlacing(file);
        if (!bp) return undefined;
        return orientRaw(toFileJson(scriptsOn ? { ...bp, scripts: (bp.scripts ?? []).map((sc) => ({ ...sc, enabled: true })) } : bp, registry, { inlineScripts: true }), { flip }, registry);
      };
      // Clear robots while the blueprints load makes a new world: drop the stress test rather than fill that one.
      const world = worldScreen.world;
      const go = async (): Promise<void> => {
        let placed = 0;
        if (kind === 'hover') {
          const bp = await load('missile-drone-10prop.json', true);
          if (!bp || worldScreen.world !== world) return;
          placed = worldScreen.stress(bp, 0, HOVER_GRID(n));
        } else {
          const left = await load('enemy-drone.json', false);
          const right = await load('enemy-drone.json', false, true);
          if (!left || !right || worldScreen.world !== world) return;
          // Team 1 on the left facing right, team 2 on the right flipped to face it.
          placed = worldScreen.stress(left, 1, BATTLE_GRID(n), -75) + worldScreen.stress(right, 2, BATTLE_GRID(n), 75);
          n *= 2;
        }
        const short = placed < n ? ` Placed ${placed} of ${n}: the rest had no room around the middle of the screen.` : '';
        if (kind === 'battle') notify(store, `A battle: Red against Blue. Neither side is yours, so you only watch.${short}`);
        else if (short !== '') notify(store, `Stress:${short}`);
      };
      go().catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
    },
    clearDebris: () => worldScreen.clearDebris(),
    toggleRemoving: () => worldScreen.toggleRemoving(),
    removeFar: () => {
      const n = worldScreen.removeFar();
      notify(store, n === 0 ? 'Nothing is that far from the camera.' : `Removed ${robotsText(n)} far from the camera.`);
    },
    setFarDistance: (meters) => worldScreen.setFarDistance(meters),
    removeTeam: (team) => {
      const n = worldScreen.removeTeam(team);
      notify(store, `Removed ${robotsText(n)}: all ${team === 0 ? 'yours' : teamName(team)}.`);
    },
    saveReplay: () => {
      const { replay, robot } = worldScreen.replay();
      const file = replayFileName(new Date(), robot);
      saveReplayFile(file, replay)
        .then(() => notify(store, `Saved replays/${file}. Rerun it with: pnpm sim replay ${file.slice(0, -'.json'.length)}`))
        .catch((e: unknown) => notify(store, `Could not save the replay: ${e instanceof Error ? e.message : String(e)}`));
    },
    toBuilder: () => {
      worldScreen.cancelPlacing();
      worldScreen.stopRemoving();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
    },
    setBindings: (bindings) => editControls((c) => ({ ...c, bindings })),
    claimAuto: (ids, byKind) => builder.edit((bp) => claimAuto(bp, registry, builder.controlsFor, ids, { byKind })),
    lightParts: (ids) => builder.lightParts(ids),
    dragValue: (on) => (on ? builder.beginTextEdit('drag') : builder.endTextEdit('drag')),
    addTag: (ids, tag) => builder.edit((bp) => addTagToParts(bp, ids, tag)),
    removeTag: (ids, tag) => builder.edit((bp) => removeTagFromParts(bp, ids, tag)),
    setAuto: (ids, on) => builder.edit((bp) => setPartsAuto(bp, ids, on)),
    setArmed: (ids, on) => builder.edit((bp) => setPartsArmed(bp, ids, on)),
    resize: (ids, dw, dh) =>
      builder.edit((bp) =>
        setPartsSize(
          bp,
          ids,
          (size) => {
            // Within its def's range; it grows right and up from its origin (its floor's left cell under the hollow).
            const st = bp.parts.find((p) => ids.includes(p.id) && registry.has(p.part) && registry.get(p.part).stretch)?.part;
            const spec = st ? registry.get(st).stretch : undefined;
            if (!spec) return size;
            return [Math.max(spec.min[0], Math.min(spec.max[0], size[0] + dw)), Math.max(spec.min[1], Math.min(spec.max[1], size[1] + dh))];
          },
          registry,
        ),
      ),
    setMakes: (ids, choice) => {
      if (choice === undefined) return builder.edit((bp) => setPartsMakes(bp, ids, undefined));
      if ('recipe' in choice) return builder.edit((bp) => setPartsMakes(bp, ids, bp.recipes?.find((r) => r.name === choice.recipe)));
      // A copy of the saved blueprint, scripts and all, becomes the recipe (M12): later edits to that file change nothing here.
      doc
        .loadForPlacing(choice.file)
        .then((recipe) => {
          // A recipe cannot carry recipes of its own.
          const { recipes: _own, ...plain } = recipe ?? { recipes: undefined };
          if (recipe) builder.edit((bp) => setPartsMakes(bp, ids, { name: recipe.name, blueprint: plain as typeof recipe }));
        })
        .catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
    },
    setAutoControls: (on) => builder.edit((bp) => (controlsOf(bp, registry, builder.controlsFor).autoOn === on ? bp : withControls(bp, registry, builder.controlsFor, { autoOn: on }))),
    setControlsFor: (core) => {
      builder.setControlsFor(core);
      store.set({ scriptEditor: undefined });
    },
    holdBlueprint: (file) => {
      doc
        .loadForPlacing(file)
        .then((bp) => {
          if (bp) builder.dispatch({ type: 'holdBlueprint', name: bp.name, bp });
        })
        .catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
    },
    eraser: () => builder.dispatch({ type: 'eraser' }),
    putDown: () => {
      if (handFull(builder.editor)) builder.dispatch({ type: 'escape' });
    },
    duplicate: () => builder.dispatch({ type: 'duplicate' }),
    swapTo: (ids, type) => builder.swapTo(ids, type),
    acceptOffer: (offer) => builder.acceptOffer(offer),
    dismissNote: (seq) => builder.dismissNote(seq),
    dismissCursorNote: (seq) => builder.dismissCursorNote(seq),
    showScript: (id) => builder.showScript(id),
    revealScript: (core, id) => {
      if (builder.controlsFor !== core) actions.setControlsFor(core);
      builder.showScript(id);
      actions.showTab('behaviors');
    },
    openProblem: (problem) => {
      if (!problem.open) return;
      if (builder.controlsFor !== problem.open.core) actions.setControlsFor(problem.open.core);
      scriptLineSeq++;
      store.set({ scriptEditor: problem.open.id, scriptLine: problem.line !== undefined ? { line: problem.line, seq: scriptLineSeq } : undefined });
      actions.showTab('behaviors');
    },
    fixName: (fix) => builder.fixName(fix),
    toggleMirror: () => builder.dispatch({ type: 'toggleMirror' }),
    undo: () => builder.undo(),
    redo: () => builder.redo(),
    rename: (name) => builder.edit((bp) => (name.trim() === '' || name.trim() === bp.name ? bp : { ...bp, name: name.trim() })),
    setKind: (kind) => {
      const k = kind === undefined ? undefined : cleanKind(kind);
      builder.edit((bp) => {
        if (bp.kind === k) return bp;
        const { kind: _old, ...rest } = bp;
        return k === undefined ? rest : { ...rest, kind: k };
      });
    },
    setFileKind: (file, kind) => {
      const k = kind === undefined ? undefined : cleanKind(kind);
      setBlueprintKind(file, k ?? null)
        .then(() => syncDoc(true))
        .catch((e: unknown) => notify(store, `Could not change its kind: ${e instanceof Error ? e.message : String(e)}`));
    },
    setHotbarSlot: (slot, part) => setHotbar(setSlot(store.get().hotbar, slot, part)),
    swapHotbarSlots: (a, b) => setHotbar(swapSlots(store.get().hotbar, a, b)),
    needMeta: (files) => {
      const have = store.get().meta;
      for (const f of files) if (!(f in have) && !metaQueue.includes(f)) metaQueue.push(f);
      void pumpMeta();
    },
    select: (ids) => builder.select(ids),
    showTab: (tab) => store.set((s) => ({ panel: { ...s.panel, tab } })),
    script: () => {
      // One script: straight to its code (again closes it). None or several: the list.
      const scripts = store.get().builder.controls.scripts;
      const only = scripts.length === 1 ? scripts[0] : undefined;
      if (store.get().scriptEditor !== undefined) store.set({ scriptEditor: undefined });
      else if (only) store.set({ scriptEditor: only.id });
      store.set((s) => ({ panel: { ...s.panel, tab: 'behaviors' } }));
    },
    addScript: () => {
      let id = '';
      editControls((c) => {
        const r = addScript(c);
        id = r.id;
        return r.bp;
      });
      store.set({ scriptEditor: id });
    },
    removeScript: (id) => {
      const core = builder.controlsFor;
      const card = behaviorCards(builder.draft, registry, [], core).find((c) => c.id === id);
      const groups = clearableGroups(builder.draft, registry, core, id);
      const name = card?.header?.name ?? `"${id}"`;
      const filled = groups.map((g) => `"${g.tag}"`).join(' and ');
      // Groups its slots filled that a key or another script still uses: they stay either way, and the box says so.
      const kept = (card?.slots ?? []).filter((sl) => sl.filled.length > 0 && !groups.some((g) => g.tag === sl.tag)).map((sl) => `"${sl.tag}"`);
      const stays = kept.length === 0 ? '' : ` ${kept.join(' and ')} ${kept.length === 1 ? 'stays' : 'stay'} either way: a key or another script uses ${kept.length === 1 ? 'it' : 'them'}.`;
      void ask(store, {
        title: `Remove ${name}?`,
        message:
          groups.length > 0
            ? `Removes it from this robot, with the key that switches it. Its slots put parts in the group${groups.length === 1 ? '' : 's'} ${filled}: clearing ${groups.length === 1 ? 'that' : 'those'} too gives the parts it drove their own keys back.${stays} Undo brings all of it back.`
            : `Removes it from this robot, with the key that switches it.${stays}${card?.file !== undefined ? ` Its file stays in blueprints/ until you delete it.` : ''} Undo brings it back.`,
        buttons: [
          { label: 'Cancel', value: 'no' },
          ...(groups.length > 0 ? [{ label: 'Remove, keep groups', value: 'keep' }, { label: 'Remove and clear groups', value: 'clear', kind: 'danger' as const }] : [{ label: 'Remove', value: 'keep', kind: 'danger' as const }]),
        ],
        cancelValue: 'no',
      }).then((a) => {
        if (a.value === 'no') return;
        builder.editAndSay((bp) => removeBehavior(bp, registry, core, id, a.value === 'clear'));
        if (store.get().scriptEditor === id) store.set({ scriptEditor: undefined });
      });
    },
    loadShelf,
    addBehavior: (shelfId) => {
      const entry = store.get().shelf.entries.find((e) => e.id === shelfId);
      if (!entry) return notify(store, `The shelf has no behavior called ${shelfId}.`);
      const state = startFill(builder.draft, registry, entry, builder.controlsFor);
      if ('error' in state) return notify(store, state.error);
      builder.startFill(state);
    },
    changeSlot: (scriptId, group) => {
      const state = startChange(builder.draft, registry, builder.controlsFor, scriptId, group);
      if ('error' in state) return notify(store, state.error);
      builder.startFill(state);
    },
    fillAccept: () => builder.fillAccept(),
    fillPick: (all) => builder.fillPick(all),
    fillSkip: () => builder.fillSkip(),
    fillBack: () => builder.fillBack(),
    fillCancel: () => builder.fillCancel(),
    showBehaviorUpdate: (scriptId) => {
      if (scriptId !== undefined) loadShelf();
      store.set({ behaviorUpdate: scriptId });
    },
    applyBehaviorUpdate: (scriptId) => {
      builder.editAndSay((bp) => applyUpdate(bp, registry, store.get().shelf.entries, builder.controlsFor, scriptId));
      store.set({ behaviorUpdate: undefined });
    },
    setScriptKey: (scriptId, key) => builder.edit((bp) => setScriptKey(bp, registry, builder.controlsFor, scriptId, key)),
    setReadout: (open) => worldScreen.setReadout(open),
    renameScript: (from, to) => {
      editControls((c) => renameScript(c, from, to));
      const renamed = cleanScriptId(to);
      if (store.get().scriptEditor === from && controlsOf(builder.draft, registry, builder.controlsFor).scripts.some((x) => x.id === renamed)) store.set({ scriptEditor: renamed });
    },
    setScriptEnabled: (id, on) => editControls((c) => updateScript(c, id, { enabled: on })),
    openScript: (id) => store.set({ scriptEditor: id, scriptLine: undefined }),
    closeScript: () => store.set({ scriptEditor: undefined, scriptLine: undefined }),
    setScriptSource: (id, source) => editControls((c) => updateScript(c, id, { source })),
    setScriptParam: (id, name, value) =>
      editControls((c) => {
        const s = c.scripts.find((x) => x.id === id);
        if (!s) return c;
        const params = { ...s.params };
        if (value === undefined) delete params[name];
        else params[name] = value;
        return updateScript(c, id, { params });
      }),
    checkScript: (source, name) => {
      const r = scriptHost.compile(source, { name, seed: 0 });
      if (!r.ok) return r;
      const params = { ...r.instance.params };
      r.instance.dispose();
      return { ok: true, params };
    },
    beginTextEdit: (owner) => builder.beginTextEdit(owner),
    endTextEdit: (owner) => builder.endTextEdit(owner),
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
      // A slot half filled is called off: Test tries the robot as it is.
      builder.fillCancel();
      const d = deployDecision(store.get().builder.issues, doc.isDirty());
      if (d.step === 'blocked') {
        notify(store, `Fix ${d.errors} problem${d.errors === 1 ? '' : 's'} before testing. The list is at the bottom right.`);
        store.set((s) => ({ panel: { ...s.panel, problemsOpen: true } }));
        return;
      }
      // Unsaved changes: the small box at the button (M16). With nothing unsaved, straight through.
      if (d.step === 'confirm-unsaved') {
        store.set({ testBox: true });
        return;
      }
      startTest().catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
    },
    testChoice: (choice) => {
      store.set({ testBox: undefined });
      run(testChoice(choice, { save: () => doc.save(), test: startTest }));
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
  if (duel.length === 2) {
    const [a, b] = duel as [string, string];
    const load = async (name: string, flip: boolean): Promise<unknown> => {
      const bp = await doc.loadForPlacing(`${name}.json`);
      if (!bp) throw new Error(`duel: no blueprint named ${name}`);
      return orientRaw(toFileJson({ ...bp, scripts: (bp.scripts ?? []).map((sc) => ({ ...sc, enabled: true })) }, registry, { inlineScripts: true }), { flip }, registry);
    };
    // The lowest core height the world takes it at, from the ground up, unless the page address gives one.
    const height = (raw: unknown, x: number, given: string | null): number => {
      if (given !== null && Number.isFinite(Number(given))) return Number(given);
      for (let y = 0.5; y < 200; y += 0.05) if (worldScreen.world.canPlace(raw, { x, y }).ok) return y;
      throw new Error('duel: no room to spawn on the ground');
    };
    const go = async (): Promise<void> => {
      const left = await load(a, false);
      const right = await load(b, true);
      setMode(enterWorld({ ...modes, paused: true, pausedBeforeBuilder: true }));
      // Teams and order as `pnpm sim duel` gives them, so the fight is the same one: the left one first (robot 1,
      // team 0: yours, so the camera follows it), then the right one (robot 2, team 1).
      // M14: `&xa=` and `&xb=` move them (the default 800 m apart is past a laser's reach).
      const at = (given: string | null, fallback: number): number => (given !== null && Number.isFinite(Number(given)) ? Number(given) : fallback);
      const xa = at(query.get('xa'), -400);
      const xb = at(query.get('xb'), 400);
      const ra = worldScreen.spawn(left, { x: xa, y: height(left, xa, query.get('ya')) }, 0);
      const rb = worldScreen.spawn(right, { x: xb, y: height(right, xb, query.get('yb')) }, 1);
      // The match as `pnpm sim duel` judges it: a titan loses when its main core is destroyed or leaves the arena (past
      // x 1000 or above y 250, MATCH_ARENA); both lost within 2 s, or 240 s gone with both alive, is a draw. The world runs on after the result.
      const world = worldScreen.world;
      const sides = [ra, rb].map((robot, i) => ({ name: i === 0 ? a : b, main: robot.parts.get(robot.primaryCoreId ?? ''), holder: robot, lost: undefined as string | undefined, tick: 0 }));
      let over = false;
      worldScreen.afterStep = () => {
        if (over || worldScreen.world !== world) return;
        const t = (world.tick / 60).toFixed(1);
        for (const side of sides) {
          const main = side.main;
          if (side.lost !== undefined) continue;
          const holder = main && main.health > 0 ? world.robots.find((r) => r.parts.get(main.id) === main) : undefined;
          if (!main || !holder) {
            side.lost = `its main core was destroyed at ${t} s`;
          } else {
            const pose = partWorldPose(world, holder, main.id);
            if (!inArena(MATCH_ARENA, pose)) side.lost = `its main core went out of bounds at ${t} s, at (${pose.x.toFixed(0)}, ${pose.y.toFixed(0)})`;
          }
          if (side.lost !== undefined) side.tick = world.tick;
        }
        const [sa, sb] = sides as [(typeof sides)[number], (typeof sides)[number]];
        const first = Math.min(sa.lost !== undefined ? sa.tick : Infinity, sb.lost !== undefined ? sb.tick : Infinity);
        if (first !== Infinity && world.tick >= first + 120) {
          over = true;
          if (sa.lost !== undefined && sb.lost !== undefined) notify(store, `Draw: both lost within 2 s (${sa.name}: ${sa.lost}; ${sb.name}: ${sb.lost}). The world runs on.`);
          else notify(store, `${sa.lost !== undefined ? sb.name : sa.name} wins: ${sa.lost !== undefined ? sa.name : sb.name} lost, ${sa.lost ?? sb.lost}. The world runs on.`);
        } else if (first === Infinity && world.tick >= 240 * 60) {
          over = true;
          notify(store, 'Draw: 240 s gone with both main cores alive. The world runs on.');
        }
      };
      notify(store, `${a} (left, yours) against ${b} (right), ${Math.abs(xb - xa)} m apart. Click either to follow it and read its panel. Paused: press play to start.`);
    };
    go().catch((e: unknown) => notify(store, e instanceof Error ? e.message : String(e)));
  }

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
  canvas.addEventListener('pointerleave', () => {
    if (modes.mode === 'world') worldScreen.onPointerLeave();
  });

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
    // The library is over the board: its keys are its own.
    if (isTypingTarget(e.target) || store.get().dialog || (modes.mode === 'builder' && store.get().panel.overlay === 'library')) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      worldScreen.cancelPlacing();
      worldScreen.stopRemoving();
      builder.endGesture();
      setMode(toggleMode({ ...modes, paused: worldScreen.time.paused }));
      return;
    }
    if (modes.mode === 'world' && e.code === 'Escape' && worldScreen.isPlacing) {
      worldScreen.cancelPlacing();
      return;
    }
    if (modes.mode === 'world' && e.code === 'Escape' && worldScreen.isRemoving) {
      worldScreen.stopRemoving();
      return;
    }
    // While a robot is held for deploying, F flips it and R turns it (M8), like the builder's stamp; they do not reach
    // the robot you are driving.
    if (modes.mode === 'world' && worldScreen.isPlacing && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && (codeOf(e) === 'KeyF' || codeOf(e) === 'KeyR')) {
      e.preventDefault();
      if (codeOf(e) === 'KeyF') worldScreen.flipPlacing();
      else worldScreen.turnPlacing();
      return;
    }
    // Shift while placing is for Shift+click (keep placing): it does not reach the robot you are driving either.
    if (modes.mode === 'world' && worldScreen.isPlacing && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) return;
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
  // After Pixi's own render (LOW): how long the whole frame took to draw, for Smooth's time budget.
  renderer.app.ticker.add(
    () => {
      if (modes.mode === 'world') worldScreen.frameDrawn();
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );
}

boot().catch((err: unknown) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = String(err);
});
