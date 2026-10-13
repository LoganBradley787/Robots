import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readdirSync } from 'node:fs';
import { copyParts } from '../src/blueprint/edit';
import { assignScriptFiles, resolveScripts, scriptFiles } from '../src/blueprint/scripts';
import { toFileJson } from '../src/blueprint/serialize';
import { loadBlueprint } from '../src/blueprint/validate';
import { createQuickJsHost } from '../src/script/quickjs';
import { scriptNameIssues, scriptRuns } from '../src/script/reading';
import { attachBehavior, behaviorCopy, behaviorId, behaviorOrigin, fillSlot, fitBehavior, parseBehaviorHeader, type BehaviorHeader } from '../src/script/shelf';
import type { ScriptHost } from '../src/script/types';
import { built, give, raw, registry, shelf, shipped } from './shelfHelp';

/** Shared behaviors (M16, `script/shelf.ts`): the header a shelf file carries, what could fill its slots, and adding one to a robot. */
const GOOD = `// @behavior Hover
// @about Holds a height.
// @version 3
// @slot lift throttle "what lifts" required many owns guess up
// @slot level spin|deflect "what levels" optional one
// @needs sensor "something that sees"
// @note First note.
// Plain words in the header are fine.

// @note Second note, after a blank line.
const a = 1;
// @note Not in the header: the code has started.
function tick() {}
`;

const header = (text: string): BehaviorHeader => {
  const h = parseBehaviorHeader(text).header;
  if (!h) throw new Error('no header');
  return h;
};

describe('parseBehaviorHeader', () => {
  it('reads the name, the line about it, the version, the slots, the needs and the notes', () => {
    const p = parseBehaviorHeader(GOOD);
    expect(p.problems).toEqual([]);
    expect(p.header).toEqual({
      name: 'Hover',
      about: 'Holds a height.',
      version: 3,
      slots: [
        { group: 'lift', inputs: ['throttle'], label: 'what lifts', required: true, many: true, owns: true, guess: [{ kind: 'up' }] },
        { group: 'level', inputs: ['spin', 'deflect'], label: 'what levels', required: false, many: false, owns: false, guess: [] },
      ],
      needs: [{ block: 'sensor', label: 'something that sees' }],
      notes: ['First note.', 'Second note, after a blank line.'],
    });
  });

  it('a slot is required and of many parts unless it says otherwise; hints name outputs and other slots', () => {
    const h = header(`// @behavior A\n// @version 1\n// @slot turn turn "what turns" guess carries:fire\n// @slot fire fire "what fires" guess has:sightSide on:turn\n`);
    expect(h.slots[0]).toEqual({ group: 'turn', inputs: ['turn'], label: 'what turns', required: true, many: true, owns: false, guess: [{ kind: 'carries', slot: 'fire' }] });
    expect(h.slots[1]?.guess).toEqual([
      { kind: 'has', output: 'sightSide' },
      { kind: 'on', slot: 'turn' },
    ]);
  });

  it('an ordinary script has no header, and that is not a problem', () => {
    expect(parseBehaviorHeader('// Hover: hold a height.\nfunction tick() {}\n')).toEqual({ problems: [] });
    expect(parseBehaviorHeader('')).toEqual({ problems: [] });
    // Header lines after the code has started are not the header.
    expect(parseBehaviorHeader('const a = 1;\n// @behavior Late\n')).toEqual({ problems: [] });
  });

  it('says what is wrong, with the line', () => {
    const p = parseBehaviorHeader(
      ['// @behavior Broken', '// @version two', '// @slot lift', '// @slot 9x throttle "bad group"', '// @slot a throttle "a" sometimes', '// @slot a spin "twice"', '// @slot b spin "b" guess sideways carries:nowhere', '// @needs sensor', '// @colour blue'].join('\n'),
    );
    expect(p.header?.name).toBe('Broken');
    expect(p.header?.version).toBe(1);
    expect(p.problems).toEqual([
      "line 2: @version must be a whole number from 1 up, not 'two'",
      'line 3: a slot is written @slot <group> <input> "<label>", then optionally required or optional, one or many, owns, and guess with its hints',
      "line 4: the group '9x' must be letters, digits, - or _, starting with a letter",
      "line 5: 'sometimes' is not known here (required, optional, one, many, owns, guess)",
      "line 6: the group 'a' is used by two slots",
      "line 7: 'sideways' is not a guess hint (up, has:<output>, carries:<slot>, on:<slot>)",
      'line 8: a need is written @needs <block> "<label>"',
      'line 9: @colour is not known (behavior, about, version, slot, needs, note, from)',
      'slot b: the hint carries:nowhere names a slot this behavior does not have',
    ]);
    expect(parseBehaviorHeader('// @behavior NoVersion\n').problems).toEqual(['there is no @version line']);
    expect(parseBehaviorHeader('// @version 2\n// @slot a b "c"\n').header).toBeUndefined();
  });
});

describe('the origin mark of a copy', () => {
  it('behaviorCopy writes @from under @version, once, and behaviorOrigin reads it back', () => {
    const copy = behaviorCopy('hover', GOOD);
    expect(copy.split('\n').slice(0, 4)).toEqual(['// @behavior Hover', '// @about Holds a height.', '// @version 3', '// @from hover 3']);
    expect(behaviorOrigin(copy)).toEqual({ id: 'hover', version: 3 });
    expect(behaviorOrigin(GOOD)).toBeUndefined();
    // The rest of the file is as it was, and a copy of a copy carries one mark, the new one.
    expect(copy.replace('// @from hover 3\n', '')).toBe(GOOD);
    expect(behaviorCopy('hover-two', copy).match(/@from/g)).toHaveLength(1);
    expect(behaviorOrigin(behaviorCopy('hover-two', copy))).toEqual({ id: 'hover-two', version: 3 });
    expect(parseBehaviorHeader(copy).problems).toEqual([]);
    expect(behaviorCopy('x', 'function tick() {}')).toBe('function tick() {}');
    expect(behaviorId('behaviors/aim-and-fire.js')).toBe('aim-and-fire');
  });

  it('the mark goes with the script through save and load: the blueprint file holds only a file name', () => {
    const g = give(shipped('drone', ['hover']), 'hover');
    expect(g.scriptId).toBe('hover');
    // Save: the copy gets a file of the robot's own, and the blueprint names it.
    const saved = assignScriptFiles(g.blueprint, 'drone-two.json', true);
    const json = toFileJson(saved, registry);
    expect((json.scripts as unknown[])[0]).toEqual({ id: 'hover', source: { file: 'drone-two.hover.js' } });
    const files = new Map(scriptFiles(saved).map((f) => [f.file, f.text]));
    expect(behaviorOrigin(files.get('drone-two.hover.js') ?? '')).toEqual({ id: 'hover', version: header(shelf('hover')).version });
    // Load: the same blueprint again, mark and groups and all.
    const loaded = loadBlueprint(resolveScripts(JSON.parse(JSON.stringify(json)), (f) => files.get(f)).raw, registry).blueprint;
    expect(loaded.scripts).toEqual(saved.scripts);
    expect(loaded.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id)).toEqual(saved.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id));
    // A deploy carries the code inline, mark included.
    const inline = (toFileJson(saved, registry, { inlineScripts: true }).scripts as { source: string }[])[0]?.source ?? '';
    expect(behaviorOrigin(inline)?.id).toBe('hover');
  });
});

describe('attachBehavior', () => {
  const blank = built({ format: 1, name: 'b', grid: ['P  C  P'] });

  it('adds the robot its own copy as a script that runs from deploy, with no file yet', () => {
    const a = attachBehavior(blank, 'hover', shelf('hover'));
    if (!a.ok) throw new Error(a.error);
    expect(a.scriptId).toBe('hover');
    expect(a.blueprint.scripts).toEqual([{ id: 'hover', enabled: true, params: {}, source: behaviorCopy('hover', shelf('hover')) }]);
    expect(blank.scripts).toEqual([]);
  });

  it('a second one gets a number; a name asked for that is taken is refused; text that is no behavior is refused', () => {
    const a = attachBehavior(blank, 'hover', shelf('hover'));
    if (!a.ok) throw new Error(a.error);
    const b = attachBehavior(a.blueprint, 'hover', shelf('hover'), { enabled: false });
    expect(b.ok && b.scriptId).toBe('hover-2');
    expect(b.ok && b.blueprint.scripts[1]?.enabled).toBe(false);
    expect(attachBehavior(a.blueprint, 'hover', shelf('hover'), { scriptId: 'hover' })).toEqual({ ok: false, error: "this robot already has a script called 'hover'" });
    expect(attachBehavior(blank, 'mine', 'function tick() {}')).toEqual({ ok: false, error: 'mine is not a behavior: it has no @behavior line' });
    expect(attachBehavior(blank, 'hover', shelf('hover'), { core: 'core@9,9' })).toEqual({ ok: false, error: 'core@9,9 is not a core with controls of its own in this blueprint' });
  });

  it('for a placed copy with its own core, the script goes on that core', () => {
    const launcher = shipped('launcher');
    const core = launcher.cores?.[0];
    if (!core) throw new Error('launcher has no second core');
    const before = core.scripts.length;
    const a = attachBehavior(launcher, 'guide', shelf('guide'), { core: core.core });
    if (!a.ok) throw new Error(a.error);
    expect(a.blueprint.scripts).toEqual(launcher.scripts);
    expect(a.blueprint.cores?.[0]?.scripts).toHaveLength(before + 1);
  });
});

describe('fitBehavior: what could fill a slot, and the first guess', () => {
  const hover = header(shelf('hover'));
  const aim = header(shelf('aim-and-fire'));

  it('Hover guesses the lifters that push up, not the ones that push down or sideways, and any gyro levels', () => {
    const bp = built({ format: 1, name: 'd', grid: ['P  G  P  T>', 'F  C  F  F', 'Pv B  .  .'] });
    const fit = fitBehavior(bp, registry, hover);
    expect(fit.ok).toBe(true);
    const lift = fit.slots.find((s) => s.slot.group === 'lift');
    expect(lift?.could).toEqual(['propeller@0,2', 'propeller@2,2', 'thruster@3,2', 'propeller@0,0']);
    expect(lift?.guess).toEqual(['propeller@0,2', 'propeller@2,2']);
    expect(lift?.tag).toBe('lift');
    expect(fit.slots.find((s) => s.slot.group === 'level')?.guess).toEqual(['gyro@1,2']);
  });

  it('a behavior that cannot work says why, in words that follow its name', () => {
    const car = built({ format: 1, name: 'car', grid: ['C  F', 'W  W'] });
    const fit = fitBehavior(car, registry, hover);
    expect(fit.ok).toBe(false);
    expect(fit.problems).toEqual(['needs something with a throttle input']);
    // An optional slot nothing can fill is no problem.
    expect(fit.slots.find((s) => s.slot.group === 'level')?.problem).toBeUndefined();
    expect(fitBehavior(car, registry, aim).problems).toEqual(['needs something with a fire input', 'needs something that sees, such as a radar']);
  });

  it('Aim and fire: a part with a fire input and a sight on a joint with a turn input is a turret; a decoupler is not a gun', () => {
    // A gun on a hinge, a fixed gun on the body, a decoupler (it has a fire input too), and a hinge that carries nothing that fires.
    const bp = built({
      format: 1,
      name: 't',
      grid: ['r  g  .  x  F', 'F  .  .  F  .', 'O  C  D  F  M>'],
      legend: { r: { part: 'rotator', rot: 0 }, g: { part: 'gun', rot: 270 }, x: { part: 'rotator', rot: 0 } },
    });
    const fit = fitBehavior(bp, registry, aim);
    expect(fit.ok).toBe(true);
    const turn = fit.slots.find((s) => s.slot.group === 'turn');
    const fire = fit.slots.find((s) => s.slot.group === 'fire');
    expect(turn?.could).toEqual(['rotator@0,2', 'rotator@3,2']);
    expect(turn?.guess).toEqual(['rotator@0,2']);
    expect(fire?.could).toEqual(['gun@1,2', 'decoupler@2,0', 'gun@4,0']);
    expect(fire?.guess).toEqual(['gun@1,2', 'gun@4,0']);
  });

  it('a gun at the end of a chain of joints: every joint with a turn input under it is guessed', () => {
    const bp = built({ format: 1, name: 'c', grid: ['F  g', 'b  .', 'a  .', 'C  O'], legend: { a: { part: 'rotator', rot: 0 }, b: { part: 'rotator', rot: 0 }, g: { part: 'gun', rot: 270 } } });
    expect(fitBehavior(bp, registry, aim).slots.find((s) => s.slot.group === 'turn')?.guess).toEqual(['rotator@0,2', 'rotator@0,1']);
  });

  it("the robot's own Hover does not take the thrusters of a missile it carries, though it could", () => {
    const drone = shipped('missile-drone');
    const fit = fitBehavior(drone, registry, hover);
    const lift = fit.slots.find((s) => s.slot.group === 'lift');
    const byId = new Map(drone.parts.map((p) => [p.id, p]));
    expect(lift?.guess.length).toBe(6);
    for (const id of lift?.guess ?? []) expect(byId.get(id)?.part).toBe('propeller');
    expect(lift?.could.some((id) => byId.get(id)?.part === 'thruster')).toBe(true);
    // The drone's own gyro levels it, not the missiles' gyros.
    const level = fit.slots.find((s) => s.slot.group === 'level');
    expect(level?.guess).toEqual(drone.parts.filter((p) => p.tags.includes('stab')).map((p) => p.id));
    expect((level?.could.length ?? 0) > (level?.guess.length ?? 0)).toBe(true);
  });

  it("a placed copy's own core fits and fills inside its scope", () => {
    const launcher = shipped('launcher');
    const core = launcher.cores?.[0];
    if (!core || core.scope === undefined) throw new Error('launcher has no scoped core');
    const guide = header(shelf('guide'));
    const fit = fitBehavior(launcher, registry, guide, { core: core.core });
    const push = fit.slots.find((s) => s.slot.group === 'push');
    expect(push?.tag).toBe(`${core.scope}.push`);
    expect(push?.could.length).toBeGreaterThan(0);
    for (const id of push?.could ?? []) expect(launcher.parts.find((p) => p.id === id)?.tags).toContain(core.scope);
    if (!push) throw new Error('no push slot');
    const filled = fillSlot(launcher, registry, push.slot, push.guess, { core: core.core });
    expect(filled.parts.filter((p) => p.tags.includes(`${core.scope}.push`)).map((p) => p.id)).toEqual(push.guess);
    expect(fitBehavior(filled, registry, guide, { core: core.core }).slots.find((s) => s.slot.group === 'push')?.filled).toEqual(push.guess);
  });
});

describe('fillSlot', () => {
  const hover = header(shelf('hover'));
  const lift = hover.slots.find((s) => s.group === 'lift');
  const level = hover.slots.find((s) => s.group === 'level');
  if (!lift || !level) throw new Error('hover has no lift or level slot');
  const bp = built({ format: 1, name: 'd', grid: ['P  G  P', 'F  C  F'] });

  it('puts the group on the chosen parts and, for a slot that owns them, takes them off their auto keys', () => {
    const out = fillSlot(bp, registry, lift, ['propeller@0,1', 'propeller@2,1']);
    expect(out.parts.filter((p) => p.tags.includes('lift')).map((p) => [p.id, p.auto])).toEqual([
      ['propeller@0,1', false],
      ['propeller@2,1', false],
    ]);
    // What levels is not owned: the gyro keeps its auto keys.
    const both = fillSlot(out, registry, level, ['gyro@1,1']);
    expect(both.parts.find((p) => p.id === 'gyro@1,1')).toMatchObject({ tags: ['level', 'gyro@1,1'] });
    expect(both.parts.find((p) => p.id === 'gyro@1,1')?.auto).toBeUndefined();
    expect(bp.parts.some((p) => p.tags.includes('lift'))).toBe(false);
  });

  it('the group becomes exactly the parts given: one left out loses the tag; filling again changes nothing', () => {
    const two = fillSlot(bp, registry, lift, ['propeller@0,1', 'propeller@2,1']);
    expect(fillSlot(two, registry, lift, ['propeller@0,1', 'propeller@2,1'])).toBe(two);
    const one = fillSlot(two, registry, lift, ['propeller@2,1']);
    expect(one.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id)).toEqual(['propeller@2,1']);
  });

  it('skips a part without the input, and an id the robot does not have', () => {
    const out = fillSlot(bp, registry, lift, ['gyro@1,1', 'frame@0,0', 'nothing@9,9', 'propeller@0,1']);
    expect(out.parts.filter((p) => p.tags.includes('lift')).map((p) => p.id)).toEqual(['propeller@0,1']);
  });

  it('a part copied with its tags is in the group too: nothing more to do', () => {
    const g = give(shipped('drone', ['hover']), 'hover');
    const copy = copyParts(g.blueprint, registry, ['propeller@0,2'], -1, 0);
    if (!copy.ok) throw new Error(copy.error);
    const added = copy.blueprint.parts.find((p) => p.id === 'propeller@-1,2');
    expect(added?.tags).toContain('lift');
    expect(added?.auto).toBe(false);
    expect(fitBehavior(copy.blueprint, registry, hover).slots[0]?.filled).toHaveLength(5);
  });
});

describe('the shelf: every file in behaviors/', () => {
  const files = readdirSync(new URL('../../../behaviors/', import.meta.url)).filter((f) => f.endsWith('.js'));
  let host: ScriptHost;
  beforeAll(async () => {
    host = await createQuickJsHost(variant);
  });

  it('has the first three behaviors', () => {
    expect(files).toEqual(expect.arrayContaining(['aim-and-fire.js', 'guide.js', 'hover.js']));
  });

  for (const file of files) {
    const id = behaviorId(file);
    it(`${id}: a header with no problems, code that compiles and has a tick`, () => {
      const source = shelf(id);
      const p = parseBehaviorHeader(source);
      expect(p.problems).toEqual([]);
      expect(p.header?.about).not.toBe('');
      expect(p.header?.slots.length).toBeGreaterThan(0);
      expect(p.header?.from).toBeUndefined();
      const c = host.compile(source, { name: file, seed: 1 });
      if (!c.ok) throw new Error(c.error.message);
      // Every param has a range, so the builder can draw a slider for it.
      for (const [name, spec] of Object.entries(c.instance.params)) expect(typeof spec.min === 'number' && typeof spec.max === 'number', name).toBe(true);
      c.instance.dispose();
      expect(source).not.toContain(String.fromCharCode(0x2014));
    });

    it(`${id}: finds its parts by slot, never by a part's type name`, () => {
      const source = shelf(id);
      // No test of a part's type, and no part type spelled as a name to drive or look for.
      expect(source).not.toMatch(/\.type\b/);
      // Quoted in the code, that is: a comment may say `charge` in backticks and mean a number, not the part.
      const quoted = [...source.matchAll(/(['"])([A-Za-z0-9_.@,-]+)\1/g)].map((m) => m[2]);
      expect(quoted.filter((q) => registry.has(q as string))).toEqual([]);
      // Every group it looks for is one of its slots.
      const groups = [...source.matchAll(/tags\.includes\('([^']+)'\)/g)].map((m) => m[1]);
      const slots = parseBehaviorHeader(source).header?.slots.map((s) => s.group) ?? [];
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) expect(slots).toContain(g);
    });
  }

  it('a robot with a behavior on it validates with nothing to say about its script', () => {
    const drone = give(shipped('drone', ['hover']), 'hover').blueprint;
    const tower = give(built({ format: 1, name: 'tower', grid: ['r  g', 'O  .', 'C  B'], legend: { r: { part: 'rotator', rot: 0 }, g: { part: 'gun', rot: 270 } } }), 'aim-and-fire').blueprint;
    for (const bp of [drone, tower]) {
      // It goes through the validator as its file would.
      const again = loadBlueprint(raw(bp), registry);
      expect(again.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(scriptRuns(again.blueprint).flatMap((run) => scriptNameIssues(run, registry))).toEqual([]);
    }
  });
});
