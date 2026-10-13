import { partDrivers, partsBuiltTargetsFit, partsReached, readScript, scriptIdMentions, scriptRuns, type Blueprint, type PartDriver, type PartRegistry, type PartSetting } from '@robots/sim-core';
import { countParts, typeName, type Fx, type SwapOutcome } from './boardOps';

/**
 * What an edit affected, said after it (M16: no warnings before an edit; do it, then say what it touched, with Undo in
 * reach). Pure: it compares the blueprint before and after one undo step and reads what drove the parts that changed.
 */

export interface NoteLine {
  text: string;
  /** Something that will not work any more: shown in the warning colour. */
  bad?: boolean;
}

export interface EditNote {
  lines: NoteLine[];
}

const SETTING: Record<PartSetting, string> = { auto: 'auto keys off', armed: 'armed at start', makes: 'what it makes', size: 'its size' };

/** "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** How a notice names a script: `turrets.js`, or `guide.js on missile1` for another core's. */
function scriptName(d: { script?: string; label: string }): string {
  const scope = /\(([^)]+)\): $/.exec(d.label)?.[1];
  const core = /^core (\S+)/.exec(d.label)?.[1];
  return `${d.script ?? 'a script'}.js${scope !== undefined ? ` on ${scope}` : core !== undefined ? ` on ${core}` : ''}`;
}

const keyName = (key: string): string => `the ${key.length === 1 ? key.toUpperCase() : key} key`;

/** The scope a driver's controls run under, from its label (`core core@2,1 (missile1): `), and whether those controls are still there. */
function scopeOf(bp: Blueprint, label: string): { scope?: string; there: boolean } {
  if (label === '') return { there: true };
  for (const c of bp.cores ?? []) {
    if (`core ${c.core}${c.scope !== undefined ? ` (${c.scope})` : ''}: ` === label) return { ...(c.scope !== undefined ? { scope: c.scope } : {}), there: true };
  }
  return { there: false };
}

function removedLines(before: Blueprint, after: Blueprint, registry: PartRegistry, removed: readonly string[]): NoteLine[] {
  const parts = before.parts.filter((p) => removed.includes(p.id));
  const drove = new Set<string>();
  const read = new Set<string>();
  const names = new Map<string, { name: string; label: string; who: string; line?: number }>();
  for (const p of parts) {
    for (const d of partDrivers(before, registry, p.id).drivers) {
      const who = d.kind === 'binding' ? keyName(d.key ?? '') : scriptName(d);
      (d.kind === 'binding' || d.kind === 'set' ? drove : read).add(who);
      if (d.kind !== 'test' && d.via !== 'id') names.set(`${d.label}\0${d.name}`, { name: d.name, label: d.label, who, ...(d.at ? { line: d.at.line } : {}) });
    }
  }
  // A script that works its targets out in code is not among the drivers: say so when the part fits a name it builds.
  const maybe = new Set<string>();
  for (const run of scriptRuns(before)) {
    if (run.recipes.length > 0 || typeof run.script.source !== 'string') continue;
    const fits = partsBuiltTargetsFit(readScript(run.script.source), before, registry, run.scope);
    if (removed.some((id) => fits.includes(id))) maybe.add(scriptName({ script: run.script.id, label: run.label }));
  }
  for (const w of drove) read.delete(w);
  for (const w of [...drove, ...read]) maybe.delete(w);
  const it = parts.length === 1 ? 'it' : 'them';
  const lines: NoteLine[] = [];
  const said: string[] = [];
  if (drove.size > 0) said.push(`${cap(listed([...drove]))} drove ${it}.`);
  if (read.size > 0) said.push(`${cap(listed([...read]))} read ${it}.`);
  if (maybe.size > 0) said.push(`${cap(listed([...maybe]))} may have driven ${it}: ${maybe.size === 1 ? 'it picks' : 'they pick'} parts in ${maybe.size === 1 ? 'its' : 'their'} own code.`);
  // A core that went took its own keys and scripts with it.
  for (const c of before.cores ?? []) {
    if (!removed.includes(c.core) || c.scripts.length + c.bindings.length === 0) continue;
    const had = [c.scripts.length > 0 ? `${c.scripts.length} script${c.scripts.length === 1 ? '' : 's'}` : '', c.bindings.length > 0 ? `${c.bindings.length} key${c.bindings.length === 1 ? '' : 's'}` : ''].filter((x) => x !== '');
    said.push(`Its own ${listed(had)} went with it.`);
  }
  if (said.length === 0) return [];
  lines.push({ text: `Removed ${countParts(registry, parts.map((p) => p.part))}. ${said.join(' ')}` });
  // A name that reached something before and reaches nothing now.
  for (const n of names.values()) {
    const s = scopeOf(after, n.label);
    if (!s.there || partsReached(after, registry, n.name, s.scope).length > 0) continue;
    lines.push({ text: `Nothing answers to '${n.name}' any more (${n.who}${n.line !== undefined ? `, line ${n.line}` : ''}).`, bad: true });
  }
  return lines;
}

function movedLines(before: Blueprint, renames: ReadonlyMap<string, string>, swapped: ReadonlySet<string>): NoteLine[] {
  const olds = [...renames].filter(([from, to]) => from !== to && !swapped.has(from)).map(([from]) => from);
  if (olds.length === 0) return [];
  const mentions = scriptIdMentions(before, olds);
  if (mentions.length === 0) return [];
  const lines: NoteLine[] = [{ text: `Moved ${olds.length} part${olds.length === 1 ? '' : 's'}. Keys follow a moved part. Script code is not rewritten:` }];
  const seen = new Set<string>();
  for (const m of mentions) {
    const key = `${m.label}\0${m.script}\0${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 3) continue;
    lines.push({ text: `${scriptName(m)} spells '${m.id}' (line ${m.line}). That part is now '${renames.get(m.id) ?? m.id}'.`, bad: true });
  }
  if (seen.size > 3) lines.push({ text: `And ${seen.size - 3} more like that. Problems lists them.`, bad: true });
  return lines;
}

/** What swaps kept, dropped, and broke, in the order a player wants to know: done, kept, still driven, will not work. */
export function swapLines(swaps: readonly SwapOutcome[], registry: PartRegistry): NoteLine[] {
  const first = swaps[0];
  if (!first) return [];
  const to = typeName(registry, first.report.to);
  const n = swaps.length;
  const lines: NoteLine[] = [];
  const froms = swaps.map((s) => s.report.from);
  lines.push({ text: `Swapped ${countParts(registry, froms)} for ${n === 1 ? `a ${to}` : `${to}s`}.` });

  const tags = [...new Set(swaps.flatMap((s) => s.report.kept.tags))];
  const settings = [...new Set(swaps.flatMap((s) => s.report.kept.settings))];
  const kept = ['place and turn', ...(tags.length > 0 ? [`group${tags.length === 1 ? '' : 's'} ${tags.join(', ')}`] : []), ...settings.map((s) => SETTING[s])];
  lines.push({ text: `Kept: ${listed(kept)}.` });

  const dropped = new Map<string, string>();
  for (const s of swaps) {
    for (const d of s.report.dropped) {
      const what = d.what === 'tag' ? `group '${d.value ?? ''}'` : d.what === 'recipe' ? `the recipe '${d.value ?? ''}'` : d.what === 'core' ? 'its keys and scripts' : SETTING[d.what];
      dropped.set(`${what}\0${d.why}`, `Dropped ${what}: ${d.why}.`);
    }
  }
  for (const text of dropped.values()) lines.push({ text, bad: true });

  const who = (d: PartDriver): string => (d.kind === 'binding' ? keyName(d.key ?? '') : scriptName(d));
  const typeTag = swaps.find((s) => s.report.typeTag !== undefined)?.report.typeTag;
  if (typeTag !== undefined) {
    const by = [...new Set(swaps.flatMap((s) => s.drivers.drivers.filter((d) => d.via === 'type' && d.kind !== 'test').map(who)))];
    lines.push({ text: `${n === 1 ? 'It' : 'They'} still answer${n === 1 ? 's' : ''} to '${typeTag}' (as a group now), so ${listed(by)} still reach${by.length === 1 ? 'es' : ''} ${n === 1 ? 'it' : 'them'}.` });
  }
  const broken = new Map<string, string>();
  for (const s of swaps) {
    for (const d of s.drivers.missing) {
      const verb = d.kind === 'get' ? 'reads' : 'writes';
      broken.set(`m\0${who(d)}\0${d.channel ?? ''}`, `${cap(who(d))} ${verb} '${d.channel ?? ''}'${d.at ? ` (line ${d.at.line})` : ''}, which a ${to} does not have. That does nothing now.`);
    }
    for (const d of s.drivers.typeTests) {
      broken.set(`t\0${who(d)}\0${d.at?.line ?? 0}`, `${cap(who(d))} tests for the type '${d.name}' in its own code${d.at ? ` (line ${d.at.line})` : ''}. A ${to} is not one, so it is skipped there. Only an edit to the script changes that.`);
    }
  }
  for (const text of broken.values()) lines.push({ text, bad: true });
  const builders = [...new Set(swaps.flatMap((s) => s.drivers.buildsTargets.map((b) => scriptName(b))))];
  if (builders.length > 0) lines.push({ text: `${cap(listed(builders))} pick${builders.length === 1 ? 's' : ''} parts in ${builders.length === 1 ? 'its' : 'their'} own code: what ${builders.length === 1 ? 'it makes' : 'they make'} of a ${to} is not known here.` });
  if (typeTag === undefined && broken.size === 0 && builders.length === 0 && swaps.every((s) => s.drivers.drivers.length === 0)) lines.push({ text: 'No key or script drove it by name.' });
  return lines;
}

/** A capital for a sentence that starts with a word; a file name (`hover.js`) is left as it is spelled. */
const cap = (s: string): string => (s.startsWith('the ') ? `T${s.slice(1)}` : s);

/**
 * The notice for one undo step, or undefined when the step touched nothing a key or a script drove (an ordinary
 * place, a delete of a plain frame). A swap always gets one: its result is shown, not asked about first.
 */
export function editNote(before: Blueprint, after: Blueprint, registry: PartRegistry, fx: Fx): EditNote | undefined {
  const renames = fx.renames ?? new Map<string, string>();
  const swaps = fx.swaps ?? [];
  const now = new Set(after.parts.map((p) => p.id));
  const removed = before.parts.filter((p) => !now.has(renames.get(p.id) ?? p.id)).map((p) => p.id);
  const lines = [
    ...swapLines(swaps, registry),
    ...(removed.length > 0 ? removedLines(before, after, registry, removed) : []),
    ...movedLines(before, renames, new Set(swaps.map((s) => s.report.oldId))),
  ];
  return lines.length > 0 ? { lines } : undefined;
}
