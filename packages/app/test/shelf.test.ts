import { describe, expect, it } from 'vitest';
import { assignScriptFiles, behaviorCopy, defaultRegistry, loadBlueprint, resolveScripts, scriptFiles, staticStats, toFileJson, validateBlueprint, type Blueprint } from '@robots/sim-core';
import { Builder } from '../src/builder/Builder';
import type { BuilderScene } from '../src/builder/BuilderScene';
import {
  applyUpdate,
  behaviorCards,
  clearableGroups,
  diffHunks,
  fillAccept,
  fillBack,
  fillCurrent,
  fillDone,
  fillAll,
  fillNone,
  fillSentence,
  fillSkip,
  fillToggle,
  finishFill,
  lineDiff,
  readShelf,
  removeBehavior,
  scriptParams,
  setScriptKey,
  shelfOffers,
  sliderRange,
  isOnOff,
  slotText,
  startChange,
  startFill,
  updateOffer,
  type FillState,
  type ShelfEntry,
} from '../src/builder/shelf';
import { handleShelfRequest } from '../src/storage/blueprintHandler';
import type { AppState } from '../src/ui/appState';
import { cardParams } from '../src/ui/ScriptsPanel';
import { createStore } from '../src/ui/store';

const registry = defaultRegistry();
// The real shelf, read as text (the test runs without Node types, as the app does).
const raw = import.meta.glob<string>('../../../behaviors/*.js', { query: '?raw', eager: true, import: 'default' });
const files = Object.entries(raw).map(([path, text]) => ({ file: path.split('/').pop() ?? path, text }));
const shelf = readShelf(files);
const entry = (id: string): ShelfEntry => shelf.find((e) => e.id === id) as ShelfEntry;
const bp = (raw: Record<string, unknown>): Blueprint => loadBlueprint({ format: 1, name: 't', ...raw }, registry).blueprint;

/** A core, two frames, a battery, a propeller on each side: the small flyer of the route. */
const flyer = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'frame', x: -1, y: 0 },
    { part: 'frame', x: 1, y: 0 },
    { part: 'battery', x: 0, y: -1 },
    { part: 'propeller', x: -2, y: 0 },
    { part: 'propeller', x: 2, y: 0 },
  ],
});
/** The flyer with a gyro, a radar, and a gun on a rotator. */
const armed = bp({
  parts: [
    { part: 'core', x: 0, y: 0 },
    { part: 'frame', x: -1, y: 0 },
    { part: 'frame', x: 1, y: 0 },
    { part: 'battery', x: 0, y: -1 },
    { part: 'propeller', x: -2, y: 0 },
    { part: 'propeller', x: 2, y: 0 },
    { part: 'gyro', x: -1, y: -1 },
    { part: 'radar', x: 1, y: -1 },
    { part: 'rotator', x: 0, y: 1 },
    { part: 'gun', x: 0, y: 2 },
  ],
});

function done(state: FillState | { error: string }): FillState {
  if ('error' in state) throw new Error(state.error);
  return state;
}

/** Adds a shelf behavior with every slot's first pick accepted. */
function add(on: Blueprint, id: string): { bp: Blueprint; scriptId: string; lines: string[] } {
  let s = done(startFill(on, registry, entry(id)));
  while (!fillDone(s)) s = fillAccept(s).state;
  const r = finishFill(on, registry, s);
  if (!r.ok) throw new Error(r.error);
  return { bp: r.bp, scriptId: r.scriptId, lines: r.lines.map((l) => l.text) };
}

describe('the shelf route of the dev server', () => {
  const store = { list: () => ['hover.js', 'notes.txt', 'aim-and-fire.js', '.hover.js.tmp'], read: (f: string) => (f.endsWith('.js') ? `// ${f}` : undefined) };
  it('lists every behavior file with its text, sorted, and nothing else', () => {
    const r = handleShelfRequest('GET', '/', store);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([
      { file: 'aim-and-fire.js', text: '// aim-and-fire.js' },
      { file: 'hover.js', text: '// hover.js' },
    ]);
  });
  it('gives one file, and is read only', () => {
    expect(handleShelfRequest('GET', '/hover.js', store)).toEqual({ status: 200, body: '// hover.js' });
    expect(handleShelfRequest('GET', '/../secret.js', store).status).toBe(400);
    expect(handleShelfRequest('GET', '/gone.txt', store).status).toBe(400);
    expect(handleShelfRequest('PUT', '/hover.js', store).status).toBe(405);
    expect(handleShelfRequest('DELETE', '/hover.js', store).status).toBe(405);
  });
});

describe('listing and fitting the shelf', () => {
  it('reads the real shelf: three behaviors, by name, with clean headers', () => {
    expect(shelf.map((e) => `${e.id}:${e.header.name}`)).toEqual(['aim-and-fire:Aim and fire', 'guide:Guide', 'hover:Hover']);
    for (const e of shelf) expect(e.problems).toEqual([]);
    // A file that is not a behavior is left out.
    expect(readShelf([...files, { file: 'plain.js', text: 'function tick() {}' }]).map((e) => e.id)).toEqual(['aim-and-fire', 'guide', 'hover']);
  });

  it('says which can work on this robot, and why the others cannot, in plain words', () => {
    const offers = shelfOffers(flyer, registry, shelf);
    expect(offers.map((o) => [o.entry.id, o.ok, o.reason])).toEqual([
      ['aim-and-fire', false, 'needs something with a fire input; needs something that sees, such as a radar'],
      ['guide', false, 'needs something with one of these inputs: spin, swivel, deflect; needs something that sees, such as a seeker'],
      ['hover', true, undefined],
    ]);
    expect(shelfOffers(armed, registry, shelf).map((o) => o.ok)).toEqual([true, true, true]);
    expect(shelfOffers(bp({ parts: [{ part: 'core', x: 0, y: 0 }] }), registry, shelf).find((o) => o.entry.id === 'hover')?.reason).toBe('needs something with a throttle input');
  });

  it('knows a behavior that is on the robot already', () => {
    const had = add(flyer, 'hover');
    expect(shelfOffers(had.bp, registry, shelf).find((o) => o.entry.id === 'hover')?.here).toEqual(['hover']);
    expect(shelfOffers(flyer, registry, shelf).find((o) => o.entry.id === 'hover')?.here).toEqual([]);
  });
});

describe('filling slots', () => {
  it('starts on the guess, with the sentence for it, and skips a slot nothing could fill', () => {
    const s = done(startFill(flyer, registry, entry('hover')));
    // The flyer has nothing with a spin input, so "what levels" is not asked about.
    expect(s.slots.map((x) => x.slot.group)).toEqual(['lift']);
    expect(fillCurrent(s)?.chosen).toEqual(['propeller@-2,0', 'propeller@2,0']);
    expect(fillSentence(s)).toBe('What lifts/pushes? These 2 parts look right.');
    const four = done(startFill(armed, registry, entry('hover')));
    expect(four.slots.map((x) => x.slot.group)).toEqual(['lift', 'level']);
  });

  it('a click adds or removes a part that could fill the slot, and refuses one that could not, saying why', () => {
    let s = done(startFill(flyer, registry, entry('hover')));
    const off = fillToggle(s, flyer, registry, 'propeller@2,0');
    expect(off.refused).toBeUndefined();
    expect(fillCurrent(off.state)?.chosen).toEqual(['propeller@-2,0']);
    expect(fillSentence(off.state)).toBe('What lifts/pushes? 1 part picked.');
    s = fillToggle(off.state, flyer, registry, 'propeller@2,0').state;
    expect(fillCurrent(s)?.chosen).toEqual(['propeller@-2,0', 'propeller@2,0']);
    const no = fillToggle(s, flyer, registry, 'frame@1,0');
    expect(no.refused).toBe('A frame has no throttle input, so it cannot be "what lifts/pushes".');
    expect(no.state).toBe(s);
  });

  it('Select all picks every part that could fill the slot, Clear picks none, and the first guess stays as it was', () => {
    // The flyer with a placed copy beside it that has its own core: its propeller could lift, but is not guessed.
    const withCopy = bp({
      parts: [
        ...flyer.parts.map((p) => ({ part: p.part, x: p.x, y: p.y })),
        { part: 'frame', x: 0, y: 1, tags: ['m1'] },
        { part: 'core', x: 0, y: 2, tags: ['m1'] },
        { part: 'propeller', x: 1, y: 2, tags: ['m1'] },
      ],
      cores: { 'core@0,2': { scope: 'm1', bindings: [], scripts: [] } },
    });
    const s = done(startFill(withCopy, registry, entry('hover')));
    expect(fillCurrent(s)?.could).toEqual(['propeller@-2,0', 'propeller@2,0', 'propeller@1,2']);
    expect(fillCurrent(s)?.guess).toEqual(['propeller@-2,0', 'propeller@2,0']);
    expect(fillSentence(s)).toBe('What lifts/pushes? These 2 parts look right.');
    const all = fillAll(s);
    expect(fillCurrent(all)?.chosen).toEqual(['propeller@-2,0', 'propeller@2,0', 'propeller@1,2']);
    expect(fillSentence(all)).toBe('What lifts/pushes? All 3 parts picked.');
    // Again changes nothing.
    expect(fillAll(all)).toBe(all);
    const none = fillNone(all);
    expect(fillCurrent(none)?.chosen).toEqual([]);
    expect(fillSentence(none)).toBe('What lifts/pushes? Click the parts on the board: 3 parts could.');
    expect(fillNone(none)).toBe(none);
    // A click after Clear picks just that one.
    expect(fillCurrent(fillToggle(none, withCopy, registry, 'propeller@1,2').state)?.chosen).toEqual(['propeller@1,2']);
    // Accepting Select all writes the group on all three.
    let t = fillAccept(all).state;
    while (!fillDone(t)) t = fillAccept(t).state;
    const r = finishFill(withCopy, registry, t);
    expect(r.ok && r.bp.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id)).toEqual(['propeller@-2,0', 'propeller@2,0', 'propeller@1,2']);
  });

  it('the banner offers Select all only while some part is left out, and Clear only while some are picked', () => {
    const scene = { cam: { x: 0, y: 0, zoom: 2, follow: false }, show() {}, drawParts() {}, drawGhost() {}, drawOverlay() {}, frame() {}, setInsets() {}, pointOf: () => ({ x: 0, y: 0 }) } as unknown as BuilderScene;
    const store = createStore<AppState>({ builder: { draft: flyer, stats: staticStats(flyer, registry) } } as unknown as AppState);
    const builder = new Builder(registry, scene, store, flyer);
    builder.startFill(done(startFill(builder.draft, registry, entry('hover'))));
    expect(store.get().builder.fill).toMatchObject({ many: true, could: 2, picked: 2 });
    builder.fillPick(false);
    expect(store.get().builder.fill).toMatchObject({ picked: 0, sentence: 'What lifts/pushes? Click the parts on the board: 2 parts could.' });
    builder.fillPick(true);
    expect(store.get().builder.fill).toMatchObject({ picked: 2, sentence: 'What lifts/pushes? These 2 parts look right.' });
    expect(builder.draft).toBe(flyer);
  });

  it('a required slot cannot be accepted empty or skipped; an optional one can be skipped and is left as it was', () => {
    let s = done(startFill(armed, registry, entry('hover')));
    s = fillToggle(fillToggle(s, armed, registry, 'propeller@-2,0').state, armed, registry, 'propeller@2,0').state;
    expect(fillSentence(s)).toBe('What lifts/pushes? Click the parts on the board: 2 parts could.');
    expect(fillAccept(s).refused).toBe('Hover needs "what lifts/pushes": pick at least one part, or cancel.');
    expect(fillSkip(s).refused).toBe('Hover needs "what lifts/pushes": it cannot be skipped.');
    s = fillToggle(s, armed, registry, 'propeller@2,0').state;
    s = fillAccept(s).state;
    expect(fillSentence(s)).toBe('What levels? This part looks right.');
    s = fillSkip(s).state;
    expect(fillDone(s)).toBe(true);
    const r = finishFill(armed, registry, s);
    expect(r.ok && r.bp.parts.filter((p) => p.tags.includes('level'))).toEqual([]);
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(['Hover now drives 1 propeller. Its own key is off.', '"what levels" is empty. Its card can fill it later.']);
  });

  it('finishing attaches the copy, writes the groups and takes owned parts off their auto keys, and says so', () => {
    const r = add(flyer, 'hover');
    expect(r.lines).toEqual(['Hover now drives 2 propellers. Their own keys are off.']);
    expect(r.scriptId).toBe('hover');
    expect(r.bp.scripts).toEqual([{ id: 'hover', enabled: true, params: {}, source: behaviorCopy('hover', entry('hover').source) }]);
    expect(r.bp.parts.filter((p) => p.tags.includes('lift')).map((p) => [p.id, p.auto])).toEqual([
      ['propeller@-2,0', false],
      ['propeller@2,0', false],
    ]);
    // Nothing else was touched.
    expect(r.bp.parts.filter((p) => !p.tags.includes('lift'))).toEqual(flyer.parts.filter((p) => p.part !== 'propeller'));
  });

  it('Aim and fire guesses the joint and what it carries; the gun keeps its own key, the joint does not', () => {
    const s = done(startFill(armed, registry, entry('aim-and-fire')));
    expect(s.slots.map((x) => [x.slot.group, x.chosen])).toEqual([
      ['turn', ['rotator@0,1']],
      ['fire', ['gun@0,2']],
    ]);
    const r = add(armed, 'aim-and-fire');
    expect(r.lines).toEqual(['Aim and fire now drives 2 parts. The own keys of 1 rotator are off: Aim and fire drives it every tick.']);
    expect(r.bp.parts.find((p) => p.id === 'gun@0,2')?.auto).toBeUndefined();
    expect(r.bp.parts.find((p) => p.id === 'rotator@0,1')?.auto).toBe(false);
  });

  it('is one undo step through the builder, and Esc changes nothing', () => {
    const scene = { cam: { x: 0, y: 0, zoom: 2, follow: false }, show() {}, drawParts() {}, drawGhost() {}, drawOverlay() {}, frame() {}, setInsets() {}, pointOf: () => ({ x: 0, y: 0 }) } as unknown as BuilderScene;
    const store = createStore<AppState>({ builder: { draft: flyer, stats: staticStats(flyer, registry) } } as unknown as AppState);
    const builder = new Builder(registry, scene, store, flyer);
    const key = (code: string): boolean => builder.onKeyDown({ code, key: code, metaKey: false, ctrlKey: false, shiftKey: false } as KeyboardEvent);

    builder.startFill(done(startFill(builder.draft, registry, entry('hover'))));
    expect(store.get().builder.fill).toMatchObject({ name: 'Hover', mode: 'add', sentence: 'What lifts/pushes? These 2 parts look right.', step: 1, steps: 1, optional: false, picked: 2 });
    key('Escape');
    expect(store.get().builder.fill).toBeUndefined();
    expect(builder.draft).toBe(flyer);
    expect(store.get().builder.canUndo).toBe(false);

    builder.startFill(done(startFill(builder.draft, registry, entry('hover'))));
    // No key edits the robot while a slot is being filled.
    key('KeyE');
    key('Delete');
    expect(store.get().builder.eraser).toBe(false);
    key('Enter');
    expect(store.get().builder.fill).toBeUndefined();
    expect(builder.draft.scripts.map((s) => s.id)).toEqual(['hover']);
    expect(builder.draft.parts.filter((p) => p.tags.includes('lift'))).toHaveLength(2);
    expect(store.get().builder.note).toMatchObject({ lines: [{ text: 'Hover now drives 2 propellers. Their own keys are off.' }], undo: true });
    // One step: one undo and it is all gone, the script, the groups and the auto keys switched off.
    builder.undo();
    expect(builder.draft).toBe(flyer);
    expect(store.get().builder.canUndo).toBe(false);
    builder.redo();
    expect(builder.draft.scripts).toHaveLength(1);
  });
});

describe('the card of a behavior', () => {
  const had = add(armed, 'hover');

  it('shows where it came from, its slots and its settings', () => {
    const [card] = behaviorCards(had.bp, registry, shelf);
    expect(card).toMatchObject({ id: 'hover', enabled: true, loaded: true, from: { id: 'hover', version: entry('hover').header.version, gone: false, edited: false }, problems: [] });
    expect(card?.from?.newer).toBeUndefined();
    expect(card?.header?.name).toBe('Hover');
    expect(card?.slots.map((s) => [s.slot.label, slotText(had.bp, registry, s), s.could])).toEqual([
      ['what lifts/pushes', '2 propellers', 2],
      ['what levels', '1 gyro', 1],
    ]);
    expect(card?.params.map((p) => p.name)).toEqual(['height', 'hold', 'climb', 'lean', 'keys']);
    expect(card?.params[0]).toEqual({ name: 'height', default: 5, min: 0, max: 200, help: 'm it climbs when deployed, then holds (switched on later it holds where it is)' });
  });

  it('is the same after the robot is saved and opened again: the mark is in the script file, the slots are groups on the parts', () => {
    const saved = assignScriptFiles({ ...had.bp, name: 'flyer' }, 'flyer.json', false);
    const json = JSON.parse(JSON.stringify(toFileJson(saved, registry))) as unknown;
    const written = new Map(scriptFiles(saved).map((f) => [f.file, f.text]));
    expect([...written.keys()]).toEqual(['flyer.hover.js']);
    const opened = loadBlueprint(resolveScripts(json, (f) => written.get(f)).raw, registry).blueprint;
    const [before] = behaviorCards(saved, registry, shelf);
    const [after] = behaviorCards(opened, registry, shelf);
    expect(after).toEqual(before);
    expect(after?.file).toBe('flyer.hover.js');
    expect(after?.slots.map((s) => s.filled)).toEqual([['propeller@-2,0', 'propeller@2,0'], ['gyro@-1,-1']]);
    expect(opened.parts.filter((p) => p.auto === false).map((p) => p.id)).toEqual(['propeller@-2,0', 'propeller@2,0']);
  });

  it('says when a required slot is empty, and an ordinary script gets a plain card', () => {
    const emptied = { ...had.bp, parts: had.bp.parts.map((p) => ({ ...p, tags: p.tags.filter((t) => t !== 'lift') })) };
    expect(behaviorCards(emptied, registry, shelf)[0]?.problems).toEqual(['"what lifts/pushes" is empty, so it does nothing yet.']);
    const plain = { ...flyer, scripts: [{ id: 'mine', enabled: false, params: { speed: 3 }, source: `const speed = param('speed', 2); // m/s\nfunction tick() {}` }], bindings: [{ key: 'h', mode: 'script' as const, script: 'mine' }] };
    expect(behaviorCards(plain, registry, shelf)).toEqual([{ id: 'mine', enabled: false, loaded: true, slots: [], params: [{ name: 'speed', default: 2, help: 'm/s' }], problems: [], key: 'h' }]);
  });

  it('change reopens one slot with what is in it, and a part taken out of an owned slot gets its own keys back', () => {
    let s = done(startChange(had.bp, registry, undefined, 'hover', 'lift'));
    expect(s.mode).toBe('change');
    expect(fillSentence(s)).toBe('What lifts/pushes? These 2 parts now.');
    s = fillToggle(s, had.bp, registry, 'propeller@2,0').state;
    const r = finishFill(had.bp, registry, fillAccept(s).state);
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(['Hover: "what lifts/pushes" is now 1 propeller.', '1 propeller taken out has its own key back.']);
    expect(r.ok && r.bp.parts.filter((p) => p.part === 'propeller').map((p) => [p.tags.includes('lift'), p.auto])).toEqual([
      [true, false],
      [false, undefined],
    ]);
    expect(r.ok && r.bp.scripts).toBe(had.bp.scripts);
    expect(startChange(had.bp, registry, undefined, 'hover', 'nope')).toEqual({ error: "Hover has no slot called 'nope'." });
  });

  it('the key that switches it is its script binding', () => {
    const keyed = setScriptKey(had.bp, registry, undefined, 'hover', 'h');
    expect(keyed.bindings).toEqual([{ key: 'h', mode: 'script', script: 'hover' }]);
    expect(behaviorCards(keyed, registry, shelf)[0]?.key).toBe('h');
    expect(setScriptKey(keyed, registry, undefined, 'hover', 'h')).toBe(keyed);
    expect(setScriptKey(keyed, registry, undefined, 'hover', 'j').bindings).toEqual([{ key: 'j', mode: 'script', script: 'hover' }]);
    expect(setScriptKey(keyed, registry, undefined, 'hover', undefined).bindings).toEqual([]);
  });

  it('remove takes the script and its key; clearing its groups gives owned parts their keys back', () => {
    const keyed = setScriptKey(had.bp, registry, undefined, 'hover', 'h');
    expect(clearableGroups(keyed, registry, undefined, 'hover').map((g) => g.tag)).toEqual(['lift', 'level']);
    const kept = removeBehavior(keyed, registry, undefined, 'hover', false);
    expect(kept.bp.scripts).toEqual([]);
    expect(kept.bp.bindings).toEqual([]);
    expect(kept.bp.parts).toBe(keyed.parts);
    expect(kept.lines.map((l) => l.text)).toEqual(['Removed Hover.']);
    const cleared = removeBehavior(keyed, registry, undefined, 'hover', true);
    expect(cleared.lines.map((l) => l.text)).toEqual(['Removed Hover. Cleared its groups lift, level. 2 propellers have their own keys back.']);
    expect(cleared.bp.parts).toEqual(armed.parts);
    // A group another script still names is not offered for clearing.
    const shared = { ...keyed, scripts: [...keyed.scripts, { id: 'mine', enabled: true, params: {}, source: `function tick() { set('lift', 'throttle', 1); }` }] };
    expect(clearableGroups(shared, registry, undefined, 'hover').map((g) => g.tag)).toEqual(['level']);
  });
});

describe('params on a card', () => {
  it('reads each param with its range and the comment after it', () => {
    const source = [`const a = param('gain', 0.6, { min: 0, max: 5 }); // how hard it pushes`, `// const old = param('old', 1);`, `const b = param("trim", -2);`, `const c = (param('lean', 45, { max: 70, min: 0 }) * Math.PI) / 180; // degrees`, `const d = param('gain', 9);`].join('\n');
    expect(scriptParams(source)).toEqual([
      { name: 'gain', default: 0.6, min: 0, max: 5, help: 'how hard it pushes' },
      { name: 'trim', default: -2 },
      { name: 'lean', default: 45, min: 0, max: 70, help: 'degrees' },
    ]);
  });

  it('the sandbox list wins, with the words from the text', () => {
    const text = scriptParams(`const a = param('gain', 0.6, { min: 0, max: 5 }); // how hard`);
    expect(cardParams(text, { gain: { default: 0.6, min: 0, max: 5 }, made: { default: 3 } })).toEqual([
      { name: 'gain', default: 0.6, min: 0, max: 5, help: 'how hard' },
      { name: 'made', default: 3 },
    ]);
    expect(cardParams(text, undefined)).toEqual(text);
  });

  it('shows a param that runs 0 to 1 from a default of 0 or 1 as an on/off switch, and a 0 to 1 amount as a slider', () => {
    expect(isOnOff({ default: 1, min: 0, max: 1 }, 1)).toBe(true);
    expect(isOnOff({ default: 0, min: 0, max: 1 }, 1)).toBe(true);
    expect(isOnOff({ default: 0.3, min: 0, max: 1 }, 0)).toBe(false);
    expect(isOnOff({ default: 1, min: 0, max: 1 }, 0.4)).toBe(false);
    expect(isOnOff({ default: 1, min: 0, max: 2 }, 1)).toBe(false);
    expect(isOnOff({ default: 1 }, 1)).toBe(false);
  });

  it('gives every param a slider range that holds its value', () => {
    expect(sliderRange({ default: 5, min: 0, max: 200 }, 5)).toEqual({ min: 0, max: 200, step: 1 });
    expect(sliderRange({ default: 1, min: 0, max: 1 }, 0)).toEqual({ min: 0, max: 1, step: 0.005 });
    expect(sliderRange({ default: 3 }, 3)).toEqual({ min: 0, max: 6, step: 0.05 });
    expect(sliderRange({ default: 3 }, 40)).toMatchObject({ min: 0, max: 40 });
    expect(sliderRange({ default: 0 }, 0)).toMatchObject({ min: -1, max: 1 });
    expect(sliderRange({ default: -2 }, -2)).toMatchObject({ min: -4, max: 4 });
  });
});

describe('the update offer', () => {
  const v1 = '// @behavior Hover\n// @about Holds a height.\n// @version 1\n// @slot lift throttle "what lifts"\nfunction tick() {\n  set("lift", "throttle", 1);\n}\n';
  const v2 = v1.replace('@version 1', '@version 2').replace('set("lift", "throttle", 1);', 'set("lift", "throttle", 0.5);\n  log("v2");');
  const old: ShelfEntry[] = readShelf([{ file: 'hover.js', text: v1 }]);
  const now: ShelfEntry[] = readShelf([{ file: 'hover.js', text: v2 }]);
  const copy = behaviorCopy('hover', v1);
  const robot: Blueprint = { ...flyer, scripts: [{ id: 'hover', enabled: true, params: { gain: 2 }, source: copy }] };

  it('is there only when the shelf has a newer version', () => {
    expect(updateOffer(copy, old)).toBeUndefined();
    expect(updateOffer('function tick() {}', now)).toBeUndefined();
    expect(behaviorCards(robot, registry, old)[0]?.from).toEqual({ id: 'hover', version: 1, gone: false, edited: false });
    expect(behaviorCards(robot, registry, now)[0]?.from).toEqual({ id: 'hover', version: 1, gone: false, newer: 2, edited: false });
    expect(behaviorCards(robot, registry, [])[0]?.from).toMatchObject({ gone: true });
  });

  it('shows the difference between the copy and the new text, without the mark line', () => {
    const offer = updateOffer(copy, now);
    expect(offer).toMatchObject({ name: 'Hover', from: 1, to: 2, edited: false, added: 3, removed: 2 });
    expect(offer?.diff.filter((d) => d.kind !== 'same').map((d) => `${d.kind} ${d.text}`)).toEqual(['del // @version 1', 'add // @version 2', 'del   set("lift", "throttle", 1);', 'add   set("lift", "throttle", 0.5);', 'add   log("v2");']);
    expect(offer?.next).toBe(behaviorCopy('hover', v2));
  });

  it('warns when the copy was edited on the robot', () => {
    const edited = copy.replace('throttle", 1', 'throttle", 0.9');
    expect(updateOffer(edited, now)?.edited).toBe(true);
    expect(behaviorCards({ ...robot, scripts: [{ id: 'hover', enabled: true, params: {}, source: edited }] }, registry, now)[0]?.from).toMatchObject({ edited: true, newer: 2 });
    const r = applyUpdate({ ...robot, scripts: [{ id: 'hover', enabled: true, params: {}, source: edited }] }, registry, now, undefined, 'hover');
    expect(r.lines[0]?.text).toBe('Hover is now version 2 (it was 1). The edits made to this copy are gone: Undo brings them back. Its settings and groups are as they were.');
  });

  it('updating replaces the text and keeps the settings; with nothing newer it changes nothing', () => {
    const r = applyUpdate(robot, registry, now, undefined, 'hover');
    expect(r.bp.scripts).toEqual([{ id: 'hover', enabled: true, params: { gain: 2 }, source: behaviorCopy('hover', v2) }]);
    expect(r.bp.parts).toBe(robot.parts);
    expect(r.lines[0]?.text).toBe('Hover is now version 2 (it was 1). Its settings and groups are as they were.');
    expect(applyUpdate(robot, registry, old, undefined, 'hover').bp).toBe(robot);
    expect(behaviorCards(r.bp, registry, now)[0]?.from).toEqual({ id: 'hover', version: 2, gone: false, edited: false });
  });

  it('lineDiff keeps what is shared, and diffHunks folds long same runs', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc').map((d) => `${d.kind}${d.text}`)).toEqual(['samea', 'delb', 'addx', 'samec']);
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const hunks = diffHunks(lineDiff(long.join('\n'), [...long.slice(0, 15), 'new', ...long.slice(15)].join('\n')), 2);
    expect(hunks.map((h) => (h.kind === 'gap' ? `gap ${h.lines}` : `${h.kind} ${h.text}`))).toEqual(['gap 13', 'same line 13', 'same line 14', 'add new', 'same line 15', 'same line 16', 'gap 13']);
  });
});

describe('review fixes (M16)', () => {
  const scene = (): BuilderScene => ({ cam: { x: 0, y: 0, zoom: 2, follow: false }, show() {}, drawParts() {}, drawGhost() {}, drawOverlay() {}, frame() {}, setInsets() {}, pointOf: () => ({ x: 0, y: 0 }) }) as unknown as BuilderScene;
  const builderOn = (on: Blueprint): { builder: Builder; store: ReturnType<typeof createStore<AppState>> } => {
    const store = createStore<AppState>({ builder: { draft: on, stats: staticStats(on, registry) } } as unknown as AppState);
    return { builder: new Builder(registry, scene(), store, on), store };
  };
  const errors = (b: Blueprint): string[] => validateBlueprint(toFileJson(b, registry), registry).issues.filter((i) => i.severity === 'error').map((i) => i.code);

  it('a group a key of this core drives is not cleared with the behavior, so the key still reaches its parts', () => {
    const had = add(armed, 'hover');
    const bound = { ...had.bp, bindings: [{ key: 'q', mode: 'hold' as const, target: 'lift', channel: 'throttle', value: 1 }] };
    expect(errors(bound)).toEqual([]);
    expect(clearableGroups(bound, registry, undefined, 'hover').map((g) => g.tag)).toEqual(['level']);
    const r = removeBehavior(bound, registry, undefined, 'hover', true);
    expect(r.bp.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id)).toEqual(['propeller@-2,0', 'propeller@2,0']);
    expect(errors(r.bp)).toEqual([]);
  });

  it('Skip, then Back, then Accept writes the slot after all', () => {
    let s = done(startFill(armed, registry, entry('aim-and-fire')));
    expect(fillCurrent(s)?.slot.group).toBe('turn');
    s = fillSkip(s).state;
    s = fillBack(s);
    s = fillAccept(s).state;
    s = fillAccept(s).state;
    const r = finishFill(armed, registry, s);
    expect(r.ok && r.bp.parts.filter((p) => p.tags.includes('turn')).map((p) => p.id)).toEqual(['rotator@0,1']);
  });

  it('two behaviors that own the same parts: clearing or changing one leaves the other in charge, keys off', () => {
    const both = add(add(armed, 'hover').bp, 'guide');
    const props = (b: Blueprint): Array<[string, boolean | undefined]> => b.parts.filter((p) => p.part === 'propeller').map((p) => [p.id, p.auto]);
    expect(both.bp.parts.filter((p) => p.tags.includes('push')).map((p) => p.id)).toEqual(['propeller@-2,0', 'propeller@2,0']);
    const removed = removeBehavior(both.bp, registry, undefined, 'guide', true);
    expect(removed.bp.parts.filter((p) => p.tags.includes('push'))).toEqual([]);
    expect(props(removed.bp)).toEqual([
      ['propeller@-2,0', false],
      ['propeller@2,0', false],
    ]);
    expect(removed.lines[0]?.text).not.toContain('propeller');
    // Taking a propeller out of Guide's "what pushes": Hover still owns it, so its own key stays off.
    let s = done(startChange(both.bp, registry, undefined, 'guide', 'push'));
    s = fillToggle(s, both.bp, registry, 'propeller@2,0').state;
    const r = finishFill(both.bp, registry, fillAccept(s).state);
    expect(r.ok && props(r.bp)).toEqual([
      ['propeller@-2,0', false],
      ['propeller@2,0', false],
    ]);
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(['Guide: "what pushes" is now 1 propeller.']);
  });

  it('adds a behavior to a second core that has no controls yet, giving it its own entry', () => {
    const two = bp({
      parts: [
        ...flyer.parts.map((p) => ({ part: p.part, x: p.x, y: p.y })),
        { part: 'frame', x: 3, y: 0 },
        { part: 'core', x: 4, y: 0 },
        { part: 'propeller', x: 5, y: 0 },
      ],
    });
    expect(two.cores ?? []).toEqual([]);
    let s = done(startFill(two, registry, entry('hover'), 'core@4,0'));
    while (!fillDone(s)) s = fillAccept(s).state;
    const r = finishFill(two, registry, s);
    if (!r.ok) throw new Error(r.error);
    expect(r.bp.scripts).toEqual([]);
    expect(r.bp.cores?.map((c) => [c.core, c.scripts.map((x) => x.id)])).toEqual([['core@4,0', ['hover']]]);
  });

  it('the robot cannot be edited while a slot is being filled, and finishing counts only parts that are still there', () => {
    const { builder, store } = builderOn(flyer);
    builder.startFill(done(startFill(builder.draft, registry, entry('hover'))));
    builder.select(['propeller@2,0']);
    expect(store.get().builder.selection).toEqual([]);
    builder.swapTo(['propeller@2,0'], 'thruster');
    builder.dispatch({ type: 'hold', part: 'battery' });
    builder.dispatch({ type: 'deleteSelection' });
    expect(builder.draft).toBe(flyer);
    expect(store.get().builder.held).toBeUndefined();
    expect(store.get().builder.fill).toBeDefined();
    // An edit made some other way all the same: the part that went is not counted.
    builder.edit((b) => ({ ...b, parts: b.parts.filter((p) => p.id !== 'propeller@2,0') }));
    builder.fillAccept();
    expect(store.get().builder.note?.lines[0]?.text).toBe('Hover now drives 1 propeller. Its own key is off.');
  });

  it("moving a placed copy's core keeps the panels on that core", () => {
    const withCopy = bp({
      parts: [
        ...flyer.parts.map((p) => ({ part: p.part, x: p.x, y: p.y })),
        { part: 'frame', x: 0, y: 1, tags: ['m1'] },
        { part: 'core', x: 0, y: 2, tags: ['m1'] },
        { part: 'propeller', x: 1, y: 2, tags: ['m1'] },
      ],
      cores: { 'core@0,2': { scope: 'm1', bindings: [], scripts: [{ id: 'mine', enabled: true, params: {}, source: 'function tick() {}' }] } },
    });
    const { builder, store } = builderOn(withCopy);
    store.set({ scriptEditor: 'mine' } as Partial<AppState>);
    builder.setControlsFor('core@0,2');
    builder.select(withCopy.parts.map((p) => p.id));
    builder.dispatch({ type: 'nudge', dx: 1, dy: 0 });
    expect(builder.draft.cores?.[0]?.core).toBe('core@1,2');
    expect(builder.controlsFor).toBe('core@1,2');
    expect(store.get().scriptEditor).toBe('mine');
  });
});
