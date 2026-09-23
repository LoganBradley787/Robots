import { describe, expect, it } from 'vitest';
import { blankBlueprint, defaultRegistry, placePart, type Blueprint } from '@robots/sim-core';
import { DocumentController, type DocumentDeps, type UnsavedChoice } from '../src/builder/document';

const reg = defaultRegistry();

function setup(files: Record<string, unknown> = {}, answers: { unsaved?: UnsavedChoice[]; names?: (string | null)[]; confirms?: boolean[] } = {}) {
  let draft: Blueprint = blankBlueprint('untitled');
  const asked: string[] = [];
  const renamed: string[] = [];
  const deps: DocumentDeps = {
    registry: reg,
    api: {
      list: async () => Object.keys(files).map((file) => ({ file, name: (files[file] as { name: string }).name })),
      load: async (file) => {
        if (!(file in files)) throw new Error(`no ${file}`);
        return structuredClone(files[file]);
      },
      save: async (file, json) => {
        files[file] = structuredClone(json);
      },
      remove: async (file) => {
        delete files[file];
      },
      loadText: async (file) => (typeof files[file] === 'string' ? (files[file] as string) : undefined),
      saveText: async (file, text) => {
        files[file] = text;
      },
    },
    getDraft: () => draft,
    setDraft: (bp) => {
      draft = bp;
    },
    renameHistory: (name) => {
      renamed.push(name);
    },
    askUnsaved: async () => {
      asked.push('unsaved');
      return answers.unsaved?.shift() ?? 'cancel';
    },
    askName: async () => {
      asked.push('name');
      return answers.names?.shift() ?? null;
    },
    confirm: async (msg) => {
      asked.push(`confirm:${msg}`);
      return answers.confirms?.shift() ?? false;
    },
  };
  const doc = new DocumentController(deps);
  return { doc, files, asked, renamed, deps, edit: (fn: (b: Blueprint) => Blueprint) => (draft = fn(draft)), draft: () => draft };
}

const carFile = { format: 1, name: 'car', grid: ['F C F', 'W . W'] };

describe('DocumentController', () => {
  it('starts on an unsaved blank blueprint that is not dirty', () => {
    const { doc } = setup();
    expect(doc.state).toEqual({ name: 'untitled' });
    expect(doc.isDirty()).toBe(false);
  });

  it('opens a file, and an edit makes it dirty', async () => {
    const t = setup({ 'car.json': carFile });
    expect(await t.doc.open('car.json')).toBe(true);
    expect(t.doc.state).toEqual({ file: 'car.json', name: 'car' });
    expect(t.draft().parts).toHaveLength(5);
    expect(t.doc.isDirty()).toBe(false);
    t.edit((b) => placePart(b, reg, 'battery', 1, 1, 0));
    expect(t.doc.isDirty()).toBe(true);
  });

  it('opening while dirty asks; cancel keeps everything', async () => {
    const t = setup({ 'car.json': carFile }, { unsaved: ['cancel'] });
    t.edit((b) => placePart(b, reg, 'frame', 0, 0, 0));
    expect(await t.doc.open('car.json')).toBe(false);
    expect(t.asked).toEqual(['unsaved']);
    expect(t.draft().parts).toHaveLength(1);
  });

  it("opening while dirty with Don't save discards the edits", async () => {
    const t = setup({ 'car.json': carFile }, { unsaved: ['discard'] });
    t.edit((b) => placePart(b, reg, 'frame', 0, 0, 0));
    expect(await t.doc.open('car.json')).toBe(true);
    expect(t.draft().name).toBe('car');
  });

  it('Save overwrites the open file', async () => {
    const t = setup({ 'car.json': carFile });
    await t.doc.open('car.json');
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.save()).toBe(true);
    expect((t.files['car.json'] as { grid: string[] }).grid).toEqual(['F C F', 'W B W']);
    expect(t.doc.isDirty()).toBe(false);
  });

  it('Save As writes a new file and leaves the original unchanged', async () => {
    const t = setup({ 'car.json': carFile }, { names: ['Car 2'] });
    await t.doc.open('car.json');
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.saveAs()).toBe(true);
    expect(t.files['car.json']).toEqual(carFile);
    expect(t.files['car-2.json']).toMatchObject({ name: 'Car 2', grid: ['F C F', 'W B W'] });
    expect(t.doc.state).toEqual({ file: 'car-2.json', name: 'Car 2' });
    expect(t.draft().name).toBe('Car 2');
    expect(t.doc.isDirty()).toBe(false);
  });

  it('Save As onto an existing file asks before overwriting', async () => {
    const t = setup({ 'car.json': carFile, 'truck.json': { format: 1, name: 'truck', grid: ['C'] } }, { names: ['truck'], confirms: [false] });
    await t.doc.open('car.json');
    expect(await t.doc.saveAs()).toBe(false);
    expect(t.asked).toContain('confirm:"truck" (blueprints/truck.json) already exists. Replace it?');
    expect(t.files['truck.json']).toEqual({ format: 1, name: 'truck', grid: ['C'] });
  });

  it('Save As onto the open file itself also asks, so the original is never replaced silently', async () => {
    const t = setup({ 'car.json': carFile }, { names: ['CAR!'], confirms: [false] });
    await t.doc.open('car.json');
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.saveAs()).toBe(false);
    expect(t.files['car.json']).toEqual(carFile);
  });

  it('refuses to save a blueprint that could not be reopened', async () => {
    const notes: string[] = [];
    const t = setup({ 'car.json': carFile });
    await t.doc.open('car.json');
    t.edit((b) => ({ ...b, bindings: [{ key: 'w', mode: 'hold', target: '', channel: '', value: 1 }] }));
    (t.doc as unknown as { deps: { notify: (m: string) => void } }).deps.notify = (m) => notes.push(m);
    expect(await t.doc.save()).toBe(false);
    expect(t.files['car.json']).toEqual(carFile);
    expect(notes[0]).toContain('Cannot save');
  });

  it('Save As renames every undo step, so undoing never brings the old name back', async () => {
    const t = setup({ 'car.json': carFile }, { names: ['Car 2'] });
    await t.doc.open('car.json');
    await t.doc.saveAs();
    expect(t.renamed).toEqual(['Car 2']);
  });

  it('Save on a never-saved blueprint behaves like Save As', async () => {
    const t = setup({}, { names: ['Rover'] });
    t.edit((b) => placePart(b, reg, 'core', 0, 0, 0));
    expect(await t.doc.save()).toBe(true);
    expect(t.files['rover.json']).toMatchObject({ name: 'Rover' });
  });

  it('a cancelled name prompt saves nothing', async () => {
    const t = setup({}, { names: [null] });
    expect(await t.doc.saveAs()).toBe(false);
    expect(Object.keys(t.files)).toEqual([]);
  });

  it('delete asks, removes the file, and keeps what is on screen as an unsaved blueprint', async () => {
    const t = setup({ 'car.json': carFile }, { confirms: [true] });
    await t.doc.open('car.json');
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.remove()).toBe(true);
    expect(t.files['car.json']).toBeUndefined();
    expect(t.doc.state).toEqual({ name: 'car' });
    expect(t.draft().parts).toHaveLength(6);
    expect(t.doc.isDirty()).toBe(true);
    expect(t.asked[0]).toContain("What's on screen stays");
  });

  it('newBlank while dirty with Save saves first', async () => {
    const t = setup({ 'car.json': carFile }, { unsaved: ['save'] });
    await t.doc.open('car.json');
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.newBlank()).toBe(true);
    expect((t.files['car.json'] as { grid: string[] }).grid).toEqual(['F C F', 'W B W']);
    expect(t.draft().parts).toEqual([]);
  });

  it('confirmLeave for deploy: clean passes, dirty asks, and Don\'t save keeps the edits in the draft', async () => {
    const t = setup({ 'car.json': carFile }, { unsaved: ['discard', 'cancel'] });
    await t.doc.open('car.json');
    expect(await t.doc.confirmLeave()).toBe(true);
    t.edit((b) => placePart(b, reg, 'battery', 1, 0, 0));
    expect(await t.doc.confirmLeave()).toBe(true);
    expect(t.draft().parts).toHaveLength(6);
    expect(t.doc.isDirty()).toBe(true);
    expect(await t.doc.confirmLeave()).toBe(false);
  });

  it('opens a blueprint with its script files; editing a script makes it dirty; Save writes the script file', async () => {
    const t = setup({
      'drone.json': { format: 1, name: 'drone', grid: ['C'], scripts: [{ id: 'hover', source: { file: 'drone.hover.js' } }] },
      'drone.hover.js': 'function tick() {}',
    });
    expect(await t.doc.open('drone.json')).toBe(true);
    expect(t.draft().scripts[0]).toMatchObject({ source: 'function tick() {}', file: 'drone.hover.js' });
    expect(t.doc.isDirty()).toBe(false);
    t.edit((b) => ({ ...b, scripts: b.scripts.map((s) => ({ ...s, source: 'function tick() { log(1); }' })) }));
    expect(t.doc.isDirty()).toBe(true);
    expect(await t.doc.save()).toBe(true);
    expect(t.files['drone.hover.js']).toBe('function tick() { log(1); }');
    expect((t.files['drone.json'] as { scripts: unknown[] }).scripts).toEqual([{ id: 'hover', source: { file: 'drone.hover.js' } }]);
    expect(t.doc.isDirty()).toBe(false);
  });

  it('a new script gets a file named after the blueprint on Save; Save As copies scripts and leaves the originals', async () => {
    const t = setup({ 'drone.json': { format: 1, name: 'drone', grid: ['C'] } }, { names: ['drone two'] });
    await t.doc.open('drone.json');
    t.edit((b) => ({ ...b, scripts: [{ id: 'hover', enabled: true, params: {}, source: 'function tick() {}' }] }));
    await t.doc.save();
    expect(t.files['drone.hover.js']).toBe('function tick() {}');
    expect(t.draft().scripts[0]?.file).toBe('drone.hover.js');
    t.edit((b) => ({ ...b, scripts: b.scripts.map((s) => ({ ...s, source: 'function tick() { /* v2 */ }' })) }));
    expect(await t.doc.saveAs()).toBe(true);
    expect(t.files['drone-two.hover.js']).toBe('function tick() { /* v2 */ }');
    expect(t.files['drone.hover.js']).toBe('function tick() {}');
    expect(t.draft().scripts[0]?.file).toBe('drone-two.hover.js');
  });

  it('reports script files that are missing', async () => {
    const notes: string[] = [];
    const t = setup({ 'drone.json': { format: 1, name: 'drone', grid: ['C'], scripts: [{ id: 'hover', source: { file: 'gone.js' } }] } });
    t.deps.notify = (m) => notes.push(m);
    expect(await t.doc.open('drone.json')).toBe(true);
    expect(notes).toEqual(['drone.json: script file not found: gone.js']);
  });
});
