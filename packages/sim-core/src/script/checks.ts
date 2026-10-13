import { nearestNames } from '../blueprint/nearest';
import type { Blueprint } from '../blueprint/types';
import type { PartRegistry } from '../parts/registry';
import { codeWords, deadNames, readScript, scriptReach, type SourceSpot } from './reading';

/**
 * What is wrong with a script on one robot, found without running it (M16, the script view's checks as you type). Each
 * comes with the exact spot in the text, so an editor can mark it in the margin and underline it, and with the real
 * names to offer instead. Pure text work over `reading.ts`: names, inputs and what the part definitions say, never a
 * part's type name. Whether the text is JavaScript at all is the sandbox's to say (it compiles it); a text that does
 * not parse still gets these checks, on whatever of it can be read.
 */
export interface ScriptCheck extends SourceSpot {
  /**
   * `target`: a plain `set()` or `get()` name no part answers to. `input`: an input or output the parts it names do
   * not have. `sees`: it reads `contacts` (or calls `scan`) and nothing on the robot sees. `tick`: it defines no
   * `tick()`, so it would stop as it starts.
   */
  kind: 'target' | 'input' | 'sees' | 'tick';
  /** One plain sentence or two. */
  message: string;
  /** The real names that could stand there instead, most likely first. For `target` and `input`. */
  suggest: string[];
}

/** Whether anything on the robot (or, under a scope, on that placed copy) fills `contacts`: a part whose definition has a `sensor` or a `radio` block. */
export function robotSees(bp: Blueprint, registry: PartRegistry, scope?: string): boolean {
  return bp.parts.some((p) => {
    if (scope !== undefined && !p.tags.includes(scope)) return false;
    if (!registry.has(p.part)) return false;
    const def = registry.get(p.part);
    return def.sensor !== undefined || def.radio !== undefined;
  });
}

/** "a propeller", "an armor plate": a part type by the name its definition gives it. */
function aKind(registry: PartRegistry, type: string): string {
  const name = (registry.has(type) ? registry.get(type).name : type).toLowerCase();
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
}

const few = (names: readonly string[], max = 6): string => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));

/**
 * The checks, in the order written. `scope` is the scope of the core the script runs under (a placed copy's own core
 * sees only its own groups: `scriptRuns`).
 */
export function scriptChecks(source: string, bp: Blueprint, registry: PartRegistry, scope?: string): ScriptCheck[] {
  const out: ScriptCheck[] = [];
  const reading = readScript(source);
  const byId = new Map(bp.parts.map((p) => [p.id, p]));
  const channels = (type: string, reads: boolean): string[] => {
    if (!registry.has(type)) return [];
    const def = registry.get(type);
    return [...def.inputs, ...(reads ? def.outputs : [])].map((c) => c.name);
  };

  const dead = new Map(deadNames(reading, bp, registry, scope).map((d) => [d.start, d]));
  for (const r of scriptReach(reading, bp, registry, scope)) {
    const n = r.name;
    if (n.use !== 'set' && n.use !== 'get') continue;
    const d = dead.get(n.start);
    if (d) {
      const mean = d.nearest !== undefined ? ` Did you mean '${d.nearest}'?` : '';
      const here = d.available.length > 0 ? ` The names on this robot: ${few(d.available, 8)}.` : ' This robot has no parts yet.';
      out.push({ kind: 'target', line: n.line, column: n.column, start: n.start, end: n.end, message: `No part answers to '${n.name}'.${mean}${here}`, suggest: d.nearest !== undefined ? [d.nearest, ...d.available.filter((a) => a !== d.nearest)] : d.available });
      continue;
    }
    if (n.channel === undefined || n.channelAt === undefined || r.channelFound !== false || r.spare === true) continue;
    const reads = n.use === 'get';
    const types = r.parts.length > 0 ? [...new Set(r.parts.flatMap((id) => byId.get(id)?.part ?? []))] : [n.name];
    const have = [...new Set(types.flatMap((t) => channels(t, reads)))];
    const near = nearestNames(n.channel, have)[0];
    const who = types.map((t) => aKind(registry, t)).join(' or ');
    const what = reads ? `'${n.channel}' is not something ${who} takes or reports.` : `'${n.channel}' is not an input of ${who}.`;
    const has = have.length > 0 ? ` It has: ${few(have, 8)}.` : reads ? ' It takes and reports nothing.' : ' It has no inputs.';
    out.push({ kind: 'input', ...n.channelAt, message: `${what}${near !== undefined ? ` Did you mean '${near}'?` : ''}${has}`, suggest: near !== undefined ? [near, ...have.filter((h) => h !== near)] : have });
  }
  for (const b of reading.built) {
    // The target is worked out as the script runs: only an input no part at all has is surely a mistake.
    if (b.channel === undefined) continue;
    const reads = b.fn === 'get';
    const every = [...new Set(registry.ids().flatMap((t) => channels(t, reads)))];
    if (every.includes(b.channel)) continue;
    const near = nearestNames(b.channel, every)[0];
    out.push({ kind: 'input', line: b.line, column: b.column, start: b.start, end: b.end, message: `No part has ${reads ? 'an input or output' : 'an input'} called '${b.channel}'.${near !== undefined ? ` Did you mean '${near}'?` : ''}`, suggest: near !== undefined ? [near] : [] });
  }

  const words = codeWords(source);
  if (!robotSees(bp, registry, scope)) {
    // The script's own `contacts` (a `const contacts = ...`, a parameter) would be something else: only the global is meant.
    const own = words.some((w) => w.text === 'contacts' && ['const', 'let', 'var'].includes(w.before));
    // The widest-looking one a robot could add, by what the definitions say (then the longest-reaching).
    const seer = registry
      .list()
      .filter((d) => d.sensor !== undefined)
      .sort((a, b) => (b.sensor?.cone ?? 0) - (a.sensor?.cone ?? 0) || (b.sensor?.range ?? 0) - (a.sensor?.range ?? 0))[0]
      ?.name.toLowerCase();
    const add = `Nothing on this robot sees${seer !== undefined ? `: add a part that does, such as a ${seer}` : ''}.`;
    // Not a property (`x.contacts`) and not a key of an object written out (`{ contacts: 1 }`).
    const first = own ? undefined : words.find((w) => w.text === 'contacts' && w.before !== '.' && !(w.after === ':' && (w.before === '{' || w.before === ',')));
    if (first) out.push({ kind: 'sees', line: first.line, column: first.column, start: first.start, end: first.end, message: `contacts is always empty here. ${add}`, suggest: [] });
    const scan = words.find((w) => w.text === 'scan' && w.before !== '.' && w.before !== 'function' && w.after === '(');
    if (scan) out.push({ kind: 'sees', line: scan.line, column: scan.column, start: scan.start, end: scan.end, message: `scan() always gives null here. ${add}`, suggest: [] });
  }

  // `function tick`, or `tick = ...` (a script may also hang it on globalThis).
  const hasTick = words.some((w) => w.text === 'tick' && (w.before === 'function' || (w.after === '=' && source[w.end] !== undefined && !/^\s*==/.test(source.slice(w.end)))));
  if (!hasTick) out.push({ kind: 'tick', line: 1, column: 1, start: 0, end: 0, message: 'There is no function tick() here, so this script would stop as it starts. tick() is what runs 60 times a second.', suggest: [] });

  return out.sort((a, b) => a.start - b.start);
}
