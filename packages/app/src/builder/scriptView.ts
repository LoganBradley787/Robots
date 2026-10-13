import {
  deadNames,
  foldScriptIssues,
  partDrivers,
  partsBuiltTargetsFit,
  readScript,
  rootPartId,
  scriptNameIssues,
  scriptReach,
  scriptRuns,
  undrivenParts,
  type Blueprint,
  type DeadName,
  type PartRegistry,
  type Recipe,
  type ScriptIssue,
  type ScriptReading,
  type ScriptRun,
  type ScriptSpec,
  type UndrivenPart,
} from '@robots/sim-core';

/**
 * What a script drives, read for the builder (M16, "scripts survive edits"): the parts a script reaches (to light up
 * on the board), the parts that look like they belong and are not driven, the dead names for Problems with the fixes
 * that are safe, and who drives each input of one part. All of it over sim-core's script reading: names and inputs,
 * never part types.
 */

/** Scripts are read over and over as the robot changes; their text rarely does. */
const readings = new Map<string, ScriptReading>();

function reading(source: string): ScriptReading {
  let r = readings.get(source);
  if (!r) {
    if (readings.size > 400) readings.clear();
    r = readScript(source);
    readings.set(source, r);
  }
  return r;
}

/** One of the names a script uses, with how many parts answer to it. */
export interface NameCount {
  name: string;
  parts: number;
  /** It reaches nothing here and nothing a bay builds would answer to it. */
  dead: boolean;
  /** A part type the robot lacks that the script drives as one of several: not a problem. */
  spare: boolean;
}

export interface ScriptShow {
  id: string;
  /** Parts it reaches through a plain name, in blueprint order. */
  reached: string[];
  /** Parts that fit a name it builds in code (`name + '.gun'`) and are not among `reached`: likely driven, not surely. */
  fits: string[];
  undriven: UndrivenPart[];
  /** It works some targets out in code, so `reached` may not be everything. */
  buildsTargets: boolean;
  names: NameCount[];
}

/** The run of one of a core's scripts (`core` absent or the primary core's id: the robot's own). */
function runOf(bp: Blueprint, registry: PartRegistry, core: string | undefined, id: string): ScriptRun | undefined {
  const own = core === undefined || core === rootPartId(bp, registry);
  return scriptRuns(bp).find((r) => r.recipes.length === 0 && r.script.id === id && (own ? r.core === undefined : r.core === core));
}

/** What one script of a core reaches on the robot. Undefined when there is no such script, or its code is not loaded. */
export function showScript(bp: Blueprint, registry: PartRegistry, core: string | undefined, id: string): ScriptShow | undefined {
  const run = runOf(bp, registry, core, id);
  if (!run || typeof run.script.source !== 'string') return undefined;
  const r = reading(run.script.source);
  const reach = scriptReach(r, bp, registry, run.scope);
  const ids = new Set(reach.flatMap((n) => n.parts));
  const dead = new Set(deadNames(r, bp, registry, run.scope).map((d) => d.name));
  const names = new Map<string, NameCount>();
  for (const n of reach) {
    if (names.has(n.name.name)) continue;
    names.set(n.name.name, { name: n.name.name, parts: n.parts.length, dead: dead.has(n.name.name), spare: n.spare === true });
  }
  return {
    id,
    reached: bp.parts.filter((p) => ids.has(p.id)).map((p) => p.id),
    fits: partsBuiltTargetsFit(r, bp, registry, run.scope).filter((x) => !ids.has(x)),
    undriven: undrivenParts(r, bp, registry, run.scope),
    buildsTargets: r.buildsTargets,
    names: [...names.values()],
  };
}

/** Where one script lives in a blueprint: the robot's own, a core's, or inside recipes. */
export interface ScriptPlace {
  id: string;
  core?: string;
  /** The recipes it is inside, outermost first. */
  recipes: string[];
}

/** A safe rewrite of one dead name: only that exact quoted text at those exact positions. */
export interface NameFix {
  from: string;
  to: string;
  /** The first line it changes, as it is and as it would be. */
  before: string;
  after: string;
  spots: Array<ScriptPlace & { start: number; end: number }>;
}

/** One thing wrong with the names a script uses, for Problems. */
export interface ScriptProblem {
  code: string;
  message: string;
  /** The script to open: the first one the problem is about. Absent for a script inside a recipe (the editor cannot open those). */
  open?: { core?: string; id: string };
  line?: number;
  fix?: NameFix;
}

const placeOf = (run: ScriptRun): ScriptPlace => ({ id: run.script.id, ...(run.core !== undefined ? { core: run.core } : {}), recipes: run.recipes });

/** The line of text around an offset. */
function lineAt(source: string, at: number): { text: string; from: number } {
  const from = source.lastIndexOf('\n', at - 1) + 1;
  const end = source.indexOf('\n', at);
  return { text: source.slice(from, end < 0 ? source.length : end), from };
}

/**
 * The dead names and wrong inputs of every script on the robot (`scriptNameIssues`), with what copies of one script
 * share said once (`foldScriptIssues`). A dead name with a real name a letter or two away carries the fix for it.
 * Spare names are not problems.
 */
export function scriptProblems(bp: Blueprint, registry: PartRegistry): ScriptProblem[] {
  const issues: ScriptIssue[] = [];
  const dead = new Map<ScriptRun, DeadName[]>();
  for (const run of scriptRuns(bp)) {
    const source = run.script.source;
    if (typeof source !== 'string') continue;
    const found = scriptNameIssues(run, registry);
    if (found.length === 0) continue;
    issues.push(...found);
    dead.set(run, deadNames(reading(source), run.blueprint, registry, run.scope));
  }
  return foldScriptIssues(issues).map((f) => {
    const first = f.runs[0] as ScriptRun;
    const line = Number(/^line (\d+):/.exec(f.body)?.[1]);
    const out: ScriptProblem = { code: f.code, message: f.message, ...(Number.isFinite(line) ? { line } : {}) };
    if (first.recipes.length === 0) out.open = { id: first.script.id, ...(first.core !== undefined ? { core: first.core } : {}) };
    if (f.code !== 'SCRIPT_TARGET') return out;
    // The dead names this message is about, in every copy of the script: the ones whose own message reads the same.
    const mine = (run: ScriptRun): DeadName[] => (dead.get(run) ?? []).filter((d) => f.body.startsWith(`line ${d.line}: ${d.use}('${d.name}'`));
    const d = mine(first)[0];
    const source = first.script.source;
    if (!d || d.nearest === undefined || typeof source !== 'string') return out;
    const to = d.nearest;
    const at = lineAt(source, d.start);
    const quote = source[d.start] ?? "'";
    out.fix = {
      from: d.name,
      to,
      before: at.text.trim(),
      after: `${at.text.slice(0, d.start - at.from)}${quote}${to}${quote}${at.text.slice(d.end - at.from)}`.trim(),
      spots: [...new Set(f.runs)].flatMap((run) => mine(run).filter((x) => x.nearest === to).map((x) => ({ ...placeOf(run), start: x.start, end: x.end }))),
    };
    return out;
  });
}

/** `bp` with one script changed, wherever it lives. The same blueprint when there is no such script or nothing changed. */
function mapScript(bp: Blueprint, registry: PartRegistry, place: ScriptPlace, fn: (s: ScriptSpec) => ScriptSpec): Blueprint {
  const [head, ...rest] = place.recipes;
  if (head !== undefined) {
    let changed = false;
    const recipes = (bp.recipes ?? []).map((r): Recipe => {
      if (r.name !== head) return r;
      const inner = mapScript(r.blueprint, registry, { ...place, recipes: rest }, fn);
      if (inner === r.blueprint) return r;
      changed = true;
      return { ...r, blueprint: inner };
    });
    return changed ? { ...bp, recipes } : bp;
  }
  let changed = false;
  const each = (list: readonly ScriptSpec[]): ScriptSpec[] =>
    list.map((s) => {
      if (s.id !== place.id) return s;
      const next = fn(s);
      if (next !== s) changed = true;
      return next;
    });
  if (place.core === undefined || place.core === rootPartId(bp, registry)) {
    const scripts = each(bp.scripts);
    return changed ? { ...bp, scripts } : bp;
  }
  const cores = (bp.cores ?? []).map((c) => (c.core === place.core ? { ...c, scripts: each(c.scripts) } : c));
  return changed ? { ...bp, cores } : bp;
}

/**
 * Points a dead name at a real one (M16): in each script the fix names, the quoted text at exactly that position
 * becomes the new name, when what stands there is still exactly the old name in quotes. Anything else is left alone.
 * One blueprint out, so it is one undo step.
 */
export function applyNameFix(bp: Blueprint, registry: PartRegistry, fix: NameFix): Blueprint {
  let out = bp;
  const places = new Map<string, { place: ScriptPlace; spots: { start: number; end: number }[] }>();
  for (const s of fix.spots) {
    const key = `${s.recipes.join('\0')}\0\0${s.core ?? ''}\0${s.id}`;
    const p = places.get(key) ?? { place: { id: s.id, ...(s.core !== undefined ? { core: s.core } : {}), recipes: s.recipes }, spots: [] };
    p.spots.push({ start: s.start, end: s.end });
    places.set(key, p);
  }
  for (const { place, spots } of places.values()) {
    out = mapScript(out, registry, place, (s) => {
      if (typeof s.source !== 'string') return s;
      let source = s.source;
      // From the end, so the earlier positions still hold.
      for (const spot of [...spots].sort((a, b) => b.start - a.start)) {
        const text = source.slice(spot.start, spot.end);
        const quote = text[0];
        if ((quote !== "'" && quote !== '"') || text !== `${quote}${fix.from}${quote}`) continue;
        source = `${source.slice(0, spot.start)}${quote}${fix.to}${quote}${source.slice(spot.end)}`;
      }
      return source === s.source ? s : { ...s, source };
    });
  }
  return out;
}

/** What drives one input of a part today, besides its auto key. */
export interface InputDriver {
  kind: 'key' | 'script';
  /** The key, or the script's id. */
  name: string;
  /** How it names the part: its type, a group, or its own name. */
  via: string;
  /** For a script: the core that runs it (absent: the robot's own), to show it in the Behaviors tab. */
  core?: string;
  line?: number;
}

export interface PartInputs {
  /** By input name. */
  inputs: Map<string, InputDriver[]>;
  /** Scripts that pick parts in their own code, so they may drive this part without naming it. */
  mayDrive: Array<{ id: string; core?: string }>;
}

/** What drives each input of one part: the keys bound to it and the scripts that write it, by the name they use. */
export function partInputs(bp: Blueprint, registry: PartRegistry, id: string): PartInputs {
  const d = partDrivers(bp, registry, id);
  const runs = scriptRuns(bp).filter((r) => r.recipes.length === 0);
  const coreOf = (label: string, script: string | undefined): string | undefined => runs.find((r) => r.label === label && r.script.id === script)?.core;
  const inputs = new Map<string, InputDriver[]>();
  for (const x of d.drivers) {
    if (x.channel === undefined || (x.kind !== 'binding' && x.kind !== 'set')) continue;
    const list = inputs.get(x.channel) ?? [];
    const core = x.kind === 'set' ? coreOf(x.label, x.script) : undefined;
    const entry: InputDriver = { kind: x.kind === 'binding' ? 'key' : 'script', name: x.kind === 'binding' ? (x.key ?? '') : (x.script ?? ''), via: x.name, ...(core !== undefined ? { core } : {}), ...(x.at ? { line: x.at.line } : {}) };
    if (!list.some((o) => o.kind === entry.kind && o.name === entry.name && o.core === entry.core)) list.push(entry);
    inputs.set(x.channel, list);
  }
  const mayDrive = d.buildsTargets.map((b) => {
    const core = coreOf(b.label, b.script);
    return { id: b.script, ...(core !== undefined ? { core } : {}) };
  });
  return { inputs, mayDrive };
}
