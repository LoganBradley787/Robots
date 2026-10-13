import { editDistance, nearestNames } from '../blueprint/nearest';
import type { Binding, Blueprint, Issue, PlacedPart, ScriptSpec } from '../blueprint/types';
import { matchesTarget, scopedView } from '../control/target';
import { scopeBase } from '../fabricate/recipe';
import type { PartRegistry } from '../parts/registry';

/**
 * Reading a script without running it (M16): the names it uses to reach parts, where each is written, and what those
 * names reach on a robot. Pure text work, no sandbox, so the builder and `pnpm sim validate` share it. It reads only
 * what is written as a plain quoted string; a script that works a target out in code (`'grip' + k`, `set(p.id, ...)`,
 * a template string) is flagged (`buildsTargets`), since the list of names is then not the whole story, and nothing
 * here guesses at what such code reaches. All of it is generic: it reads names and inputs, never part types.
 */

/** Where something is written in a script. */
export interface SourceSpot {
  /** Counted from 1. */
  line: number;
  /** Counted from 1, in characters. */
  column: number;
  /** Offsets into the source: from the first character to just past the last (for a name, its quotes included). */
  start: number;
  end: number;
}

/**
 * How a name is used: the target of `set()` or `get()`, a tag test (`tags.includes('x')`), a part type test
 * (`.type === 'x'`), or a part id test (`.id === 'x'`).
 */
export type NameUse = 'set' | 'get' | 'tag' | 'type' | 'id';

/** One plain quoted name in a script, at the spot of its quoted text (so a fix can rewrite exactly that). */
export interface ScriptName extends SourceSpot {
  name: string;
  use: NameUse;
  /** For `set` and `get`: the input or output name, when it is a plain string too. */
  channel?: string;
  channelAt?: SourceSpot;
}

/** A `set()` or `get()` whose target is worked out in code, at the spot of that code. */
export interface BuiltTarget extends SourceSpot {
  fn: 'set' | 'get';
  /** `concat`: strings joined with `+`. `template`: a template string. `id`: a part's id (`p.id`). `code`: anything else (a variable, a call). */
  how: 'concat' | 'template' | 'id' | 'code';
  /** The input or output name, when it is a plain string. */
  channel?: string;
}

export interface ScriptReading {
  /** Every plain name, in the order written. */
  names: ScriptName[];
  /** Every `set()` and `get()` with a target built in code. */
  built: BuiltTarget[];
  /** Whether the script builds any target in code: when true, `names` is not everything it may reach. */
  buildsTargets: boolean;
  /** Every plain string anywhere in the script. */
  strings: Set<string>;
}

/** One `set(` or `get(` in a script. `target` and `channel` are there only when written as a plain string. */
export interface Call {
  fn: 'set' | 'get';
  /** Counted from 1. */
  line: number;
  target?: string;
  channel?: string;
}

interface Token {
  kind: 'word' | 'string' | 'other';
  text: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

/** Words a regex may follow, where a `/` after any other word is a division. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'throw', 'new', 'instanceof']);

/**
 * The script as words, plain strings, and single characters, with comments, templates, regexes, and numbers left out.
 * Not a parser: enough to find calls without being fooled by code inside a comment or a string.
 */
function tokens(src: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  /** The offset the current line starts at. */
  let lineStart = 0;
  let i = 0;
  const newline = (at: number): void => {
    line++;
    lineStart = at + 1;
  };
  const push = (kind: Token['kind'], text: string, start: number, at: { line: number; column: number }): void => {
    out.push({ kind, text, line: at.line, column: at.column, start, end: i });
  };
  const here = (): { line: number; column: number } => ({ line, column: i - lineStart + 1 });
  /** From the opening quote at `i` to just past the closing one; counts lines, and for a template walks `${ ... }`. */
  const skipQuoted = (): void => {
    const quote = src[i];
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\n') newline(i);
      if (src[i] === '\\') i++;
      else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        for (let depth = 1; i < src.length && depth > 0; ) {
          const ch = src[i];
          if (ch === "'" || ch === '"' || ch === '`') {
            skipQuoted();
            continue;
          }
          if (ch === '\n') newline(i);
          if (ch === '{') depth++;
          if (ch === '}') depth--;
          i++;
        }
        continue;
      }
      i++;
    }
    i++;
  };
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '\n') {
      newline(i);
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === '\n') newline(i);
    } else if (ch === "'" || ch === '"') {
      const start = i;
      const at = here();
      skipQuoted();
      const body = src.slice(start + 1, i - 1);
      // A string with an escape in it is left as not plain, so nothing is claimed about what it spells.
      if (body.includes('\\')) push('other', 'string', start, at);
      else push('string', body, start, at);
    } else if (ch === '`') {
      const start = i;
      const at = here();
      skipQuoted();
      push('other', 'template', start, at);
    } else if (ch === '/') {
      const prev = out[out.length - 1];
      const divides = prev !== undefined && (prev.kind === 'word' ? !BEFORE_REGEX.has(prev.text) : prev.kind === 'string' || /^[)\]}]$|^(number|string|template|regex)$/.test(prev.text));
      const start = i;
      const at = here();
      if (divides) {
        i++;
        push('other', '/', start, at);
        continue;
      }
      // A regex: to the closing slash on this line, slashes inside [ ] not counting.
      let inClass = false;
      for (i++; i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/'); i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
      }
      i++;
      push('other', 'regex', start, at);
    } else if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      const at = here();
      while (i < src.length && /[\w$]/.test(src[i] ?? '')) i++;
      push('word', src.slice(start, i), start, at);
    } else if (/[0-9]/.test(ch)) {
      const start = i;
      const at = here();
      while (i < src.length && /[\w.]/.test(src[i] ?? '')) i++;
      push('other', 'number', start, at);
    } else {
      const start = i;
      const at = here();
      i++;
      push('other', ch, start, at);
    }
  }
  return out;
}

const spot = (t: Token): SourceSpot => ({ line: t.line, column: t.column, start: t.start, end: t.end });

/** Every plain string a script writes anywhere: the names it means to use. */
export function plainStrings(source: string): Set<string> {
  return new Set(tokens(source).flatMap((t) => (t.kind === 'string' ? [t.text] : [])));
}

/** One argument of a call: tokens `from` up to `end` (the comma or closing bracket that ends it). */
interface Arg {
  from: number;
  end: number;
  /** The one plain string the argument is, if it is that and no more. */
  plain?: Token;
}

/** A script's calls of the script API's `set` and `get`, with the tokens of their first two arguments. */
function apiCalls(t: readonly Token[]): { fn: 'set' | 'get'; at: Token; target: Arg; channel?: Arg }[] {
  const is = (k: number, text: string): boolean => t[k]?.kind === 'other' && t[k]?.text === text;
  // A script that defines its own `set` or `get` means something else by it.
  const own = new Set<string>();
  for (let k = 0; k < t.length; k++) {
    const w = t[k];
    if (w?.kind !== 'word' || (w.text !== 'set' && w.text !== 'get')) continue;
    const before = t[k - 1];
    if ((before?.kind === 'word' && ['function', 'const', 'let', 'var'].includes(before.text)) || (is(k + 1, '=') && !is(k + 2, '=') && !is(k - 1, '.'))) own.add(w.text);
  }
  // Each argument: from `from` to the comma or closing bracket that ends it. Plain when it is one string and no more.
  const arg = (from: number): Arg => {
    let depth = 0;
    let end = from;
    for (; end < t.length; end++) {
      const text = t[end]?.kind === 'other' ? t[end]?.text : undefined;
      if (text === '(' || text === '[' || text === '{') depth++;
      else if (text === ')' || text === ']' || text === '}') {
        if (depth === 0) break;
        depth--;
      } else if (text === ',' && depth === 0) break;
    }
    const first = t[from];
    return { from, end, ...(end === from + 1 && first?.kind === 'string' ? { plain: first } : {}) };
  };
  const out: ReturnType<typeof apiCalls> = [];
  for (let k = 0; k < t.length; k++) {
    const w = t[k];
    if (w?.kind !== 'word' || (w.text !== 'set' && w.text !== 'get') || own.has(w.text) || !is(k + 1, '(') || is(k - 1, '.')) continue;
    const target = arg(k + 2);
    out.push({ fn: w.text, at: w, target, ...(is(target.end, ',') ? { channel: arg(target.end + 1) } : {}) });
  }
  return out;
}

/** Every call of the script API's `set` and `get` in a script's code, in order. Methods (`map.get`) are not calls of it. */
export function calls(source: string): Call[] {
  return apiCalls(tokens(source)).map((c) => ({
    fn: c.fn,
    line: c.at.line,
    ...(c.target.plain ? { target: c.target.plain.text } : {}),
    ...(c.channel?.plain ? { channel: c.channel.plain.text } : {}),
  }));
}

/**
 * The names a script uses and where (M16): plain first arguments of `set()` and `get()` (with the plain second
 * argument, the input or output, when there is one), plain strings in `tags.includes('x')` and `tags.indexOf('x')`,
 * and plain strings compared with a `.type` or an `.id` (`p.type === 'x'`, `'x' !== p.id`, `['a', 'b'].includes(p.type)`).
 * `built` lists every `set()` and `get()` whose target is code.
 *
 * A type or id test may be about another robot's parts (`scan()` gives parts with a `type` and an `id` too), so a
 * test's name that matches nothing on this robot is not by itself a mistake.
 */
export function readScript(source: string): ScriptReading {
  const t = tokens(source);
  const is = (k: number, text: string): boolean => t[k]?.kind === 'other' && t[k]?.text === text;
  const word = (k: number, text: string): boolean => t[k]?.kind === 'word' && t[k]?.text === text;
  const found: ScriptName[] = [];
  const built: BuiltTarget[] = [];

  for (const c of apiCalls(t)) {
    const channel = c.channel?.plain;
    if (c.target.plain) {
      found.push({ name: c.target.plain.text, use: c.fn, ...spot(c.target.plain), ...(channel ? { channel: channel.text, channelAt: spot(channel) } : {}) });
      continue;
    }
    const first = t[c.target.from];
    const last = t[c.target.end - 1];
    if (!first || !last || c.target.end <= c.target.from) continue;
    let depth = 0;
    let joined = false;
    for (let k = c.target.from; k < c.target.end; k++) {
      const text = t[k]?.kind === 'other' ? t[k]?.text : undefined;
      if (text === '(' || text === '[' || text === '{') depth++;
      else if (text === ')' || text === ']' || text === '}') depth--;
      else if (text === '+' && depth === 0) joined = true;
    }
    const how: BuiltTarget['how'] = joined ? 'concat' : first.kind === 'other' && first.text === 'template' && c.target.end === c.target.from + 1 ? 'template' : last.kind === 'word' && last.text === 'id' && is(c.target.end - 2, '.') ? 'id' : 'code';
    built.push({ fn: c.fn, how, line: first.line, column: first.column, start: first.start, end: last.end, ...(channel ? { channel: channel.text } : {}) });
  }

  /** Where an equality sign ends when one starts at `k` (`==`, `===`, `!=`, `!==`), else -1. */
  const equalsEnd = (k: number): number => {
    let j = is(k, '!') ? k + 1 : k;
    if (!is(j, '=') || !is(j + 1, '=')) return -1;
    j += 2;
    return is(j, '=') ? j + 1 : j;
  };
  /** Whether tokens `from` up to `end` are a plain property chain that ends in `.type` or `.id` (`p.type`, `a.b.id`). */
  const chainEnd = (from: number, end: number): 'type' | 'id' | undefined => {
    const last = t[end - 1];
    if (end - from < 3 || last?.kind !== 'word' || (last.text !== 'type' && last.text !== 'id') || !is(end - 2, '.')) return undefined;
    for (let k = from; k < end; k++) if ((k - from) % 2 === 0 ? t[k]?.kind !== 'word' : !is(k, '.')) return undefined;
    return last.text;
  };
  for (let k = 0; k < t.length; k++) {
    const w = t[k];
    if (!w) continue;
    // tags.includes('x'), tags.indexOf('x')
    if (w.kind === 'word' && w.text === 'tags' && is(k + 1, '.') && (word(k + 2, 'includes') || word(k + 2, 'indexOf')) && is(k + 3, '(')) {
      const s = t[k + 4];
      if (s?.kind === 'string' && (is(k + 5, ')') || is(k + 5, ','))) found.push({ name: s.text, use: 'tag', ...spot(s) });
      continue;
    }
    // .type === 'x', .id !== 'x'
    if (w.kind === 'word' && (w.text === 'type' || w.text === 'id') && is(k - 1, '.')) {
      const e = equalsEnd(k + 1);
      const s = e < 0 ? undefined : t[e];
      if (s?.kind === 'string') found.push({ name: s.text, use: w.text, ...spot(s) });
      continue;
    }
    // 'x' === p.type
    if (w.kind === 'string') {
      const e = equalsEnd(k + 1);
      if (e < 0) continue;
      let end = e;
      while (t[end]?.kind === 'word' && is(end + 1, '.')) end += 2;
      if (t[end]?.kind === 'word') end++;
      const use = chainEnd(e, end);
      if (use !== undefined && !is(end, '(')) found.push({ name: w.text, use, ...spot(w) });
      continue;
    }
    // ['a', 'b'].includes(p.type)
    if (is(k, '[')) {
      const items: Token[] = [];
      let j = k + 1;
      while (t[j]?.kind === 'string' && (is(j + 1, ',') || is(j + 1, ']'))) {
        items.push(t[j] as Token);
        j += is(j + 1, ',') ? 2 : 1;
      }
      if (items.length === 0 || !is(j, ']') || !is(j + 1, '.') || !(word(j + 2, 'includes') || word(j + 2, 'indexOf')) || !is(j + 3, '(')) continue;
      let end = j + 4;
      while (end < t.length && !is(end, ')')) end++;
      const use = chainEnd(j + 4, end);
      if (use !== undefined) for (const s of items) found.push({ name: s.text, use, ...spot(s) });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return { names: found, built, buildsTargets: built.length > 0, strings: new Set(t.flatMap((x) => (x.kind === 'string' ? [x.text] : []))) };
}

/**
 * One script with what it runs on: the blueprint whose parts it sees (the robot, or a recipe a bay builds), and the
 * scope its core's controls see tags through (`scopedView`: a placed copy's core sees `missile1.fins` as `fins`).
 */
export interface ScriptRun {
  script: ScriptSpec;
  blueprint: Blueprint;
  /** The core's scope, for a placed blueprint's core. */
  scope?: string;
  /** The core's part id, for a core other than the primary one. */
  core?: string;
  /** The recipes it is inside, outermost first; empty for the robot's own scripts. */
  recipes: string[];
  /** Who runs it, for messages: '', `core core@2,1 (missile1): `, `recipe pod: `. */
  label: string;
}

/** Every script of a blueprint with what it runs on: the primary core's, each other core's, then each recipe's (and theirs). */
export function scriptRuns(bp: Blueprint): ScriptRun[] {
  const walk = (b: Blueprint, label: string, recipes: string[]): ScriptRun[] => [
    ...b.scripts.map((script) => ({ script, blueprint: b, recipes, label })),
    ...(b.cores ?? []).flatMap((c) =>
      c.scripts.map((script) => ({ script, blueprint: b, ...(c.scope !== undefined ? { scope: c.scope } : {}), core: c.core, recipes, label: `${label}core ${c.core}${c.scope !== undefined ? ` (${c.scope})` : ''}: ` })),
    ),
    ...(b.recipes ?? []).flatMap((r) => walk(r.blueprint, `${label}recipe ${r.name}: `, [...recipes, r.name])),
  ];
  return walk(bp, '', []);
}

/** How a part looks to controls under `scope`, with its definition's default tags (they join at spawn). */
function view(p: PlacedPart, registry: PartRegistry, scope: string | undefined): { part: string; tags: readonly string[] } {
  const extra = registry.has(p.part) ? (registry.get(p.part).defaultTags ?? []).filter((t) => !p.tags.includes(t)) : [];
  return scopedView(extra.length > 0 ? { ...p, tags: [...p.tags, ...extra] } : p, scope);
}

/**
 * The parts a name reaches for controls that run under `scope`, exactly as the world matches a target
 * (`matchesTarget` on `scopedView`): by tag as that core sees it, by part type, or by part id.
 */
export function partsReached(bp: Blueprint, registry: PartRegistry, name: string, scope?: string): PlacedPart[] {
  return bp.parts.filter((p) => matchesTarget(view(p, registry, scope), name));
}

/** A tag and every way a scoped core may see it: `missile1.fins` is also `fins` to missile1's own scripts. */
function scopedForms(tag: string): string[] {
  const out = [tag];
  for (let i = tag.indexOf('.'); i >= 0; i = tag.indexOf('.', i + 1)) out.push(tag.slice(i + 1));
  return out;
}

/** Every part a bay of the blueprint builds, and theirs. */
function builtParts(bp: Blueprint): PlacedPart[] {
  return (bp.recipes ?? []).flatMap((r) => [...r.blueprint.parts, ...builtParts(r.blueprint)]);
}

/**
 * Whether a name that no part carries in the file may still reach something during a run: a copy a bay builds
 * (`bay1`, `bay2.fins`: `scopeBase`), or the part type of a part of something a bay builds (the copy is part of the
 * robot until it is let go).
 */
function reachesAtRunTime(bp: Blueprint, registry: PartRegistry, name: string): boolean {
  for (const p of bp.parts) {
    const base = p.makes !== undefined && registry.has(p.part) ? scopeBase(p, registry.get(p.part)) : undefined;
    if (base === undefined) continue;
    for (const b of scopedForms(base)) if (new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+($|\\.)`).test(name)) return true;
  }
  return builtParts(bp).some((p) => p.part === name);
}

/** The inputs of a part type (and for a read its outputs too), by name. Empty for a type the registry lacks. */
function channelNames(registry: PartRegistry, type: string, reads: boolean): string[] {
  if (!registry.has(type)) return [];
  const def = registry.get(type);
  return [...def.inputs, ...(reads ? def.outputs : [])].map((c) => c.name);
}

/** What one name reaches. */
export interface NameReach {
  name: ScriptName;
  /** Ids of the parts it reaches, in blueprint order. */
  parts: string[];
  /** No part in the file, but something a bay builds may answer to it during a run (`bay1`, a built part's type). */
  atRunTime: boolean;
  /**
   * For a `set` or `get` with a plain input or output name that reaches parts: whether at least one of them has it (an
   * input for `set`; an input or an output for `get`). Undefined otherwise.
   */
  channelFound?: boolean;
}

/** What each of a script's names reaches on the blueprint, for controls running under `scope`. */
export function scriptReach(reading: ScriptReading, bp: Blueprint, registry: PartRegistry, scope?: string): NameReach[] {
  return reading.names.map((name) => {
    const parts = partsReached(bp, registry, name.name, scope);
    const out: NameReach = { name, parts: parts.map((p) => p.id), atRunTime: parts.length === 0 && reachesAtRunTime(bp, registry, name.name) };
    const channel = name.channel;
    if (channel !== undefined && (name.use === 'set' || name.use === 'get')) {
      const types = parts.length > 0 ? [...new Set(parts.map((p) => p.part))] : registry.has(name.name) && out.atRunTime ? [name.name] : [];
      if (types.length > 0) out.channelFound = types.some((t) => channelNames(registry, t, name.use === 'get').includes(channel));
    }
    return out;
  });
}

/** The ids of every part a script reaches through its plain names (for lighting them up on the board). */
export function partsScriptReaches(reading: ScriptReading, bp: Blueprint, registry: PartRegistry, scope?: string): string[] {
  const ids = new Set(scriptReach(reading, bp, registry, scope).flatMap((r) => r.parts));
  return bp.parts.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/**
 * The names controls under `scope` can use on this blueprint: the part types on it and the tags as that core sees
 * them (ids left out: there is one per part).
 */
export function namesAvailable(bp: Blueprint, registry: PartRegistry, scope?: string): { types: string[]; tags: string[] } {
  const types: string[] = [];
  const tags: string[] = [];
  for (const p of bp.parts) {
    if (!types.includes(p.part)) types.push(p.part);
    for (const t of view(p, registry, scope).tags) if (t !== p.id && !tags.includes(t)) tags.push(t);
  }
  return { types, tags: tags.filter((t) => !types.includes(t)) };
}

/** Whether two names are one tag seen with and without a scope: `fins` and `missile1.fins`. */
function scopedTwin(a: string, b: string): boolean {
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Names sorted nearest to `word` first: the same tag under or outside a scope (`missile1.fins` for `fins`), then by
 * how few letters must change (a name the word starts counts as one letter away), ties in the order given.
 */
function nearestFirst(word: string, names: readonly string[]): string[] {
  return names
    .map((name, i) => ({ name, i, d: scopedTwin(name, word) ? 0 : name.startsWith(word) ? Math.min(1, editDistance(word, name)) : editDistance(word, name) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((s) => s.name);
}

/** A name that reaches nothing, with the names that would. */
export interface DeadName extends ScriptName {
  /** The real names on the robot (`namesAvailable`: tags, then part types; part ids too when the name looks like one), nearest first. */
  available: string[];
  /** The one it was most likely meant to be (a letter or two away), if any. */
  nearest?: string;
}

/**
 * The plain names of a script that reach nothing on the blueprint: no part has that tag, part type, or id for
 * controls under `scope`, and nothing a bay builds would answer to it. By default only the targets of `set()` and
 * `get()` are judged; `uses` can add `tag` (a `tags.includes('x')` no part satisfies). Type and id tests are never
 * judged: they may be about a robot the script is looking at. Targets built in code are not guessed at.
 */
export function deadNames(reading: ScriptReading, bp: Blueprint, registry: PartRegistry, scope?: string, uses: readonly NameUse[] = ['set', 'get']): DeadName[] {
  const out: DeadName[] = [];
  let known: { types: string[]; tags: string[] } | undefined;
  for (const r of scriptReach(reading, bp, registry, scope)) {
    const n = r.name;
    if (r.parts.length > 0 || r.atRunTime || !uses.includes(n.use) || n.use === 'type' || n.use === 'id') continue;
    known ??= namesAvailable(bp, registry, scope);
    const all = [...known.tags, ...known.types, ...(n.name.includes('@') ? bp.parts.map((p) => p.id) : [])];
    const nearest = all.find((a) => scopedTwin(a, n.name)) ?? nearestNames(n.name, all)[0];
    out.push({ ...n, available: nearestFirst(n.name, all), ...(nearest !== undefined ? { nearest } : {}) });
  }
  return out;
}

/** A part a script looks like it should drive and does not. */
export interface UndrivenPart {
  /** The part's id and type. */
  part: string;
  type: string;
  /** The inputs the script writes on other parts of this type, which this part has too. */
  inputs: string[];
  /**
   * The groups the script drives those other parts through, nearest fix first: `name` as the script writes it, `tag`
   * as it must be added to the part (`missile1.fins` for a script that runs under the scope `missile1`).
   */
  groups: { name: string; tag: string }[];
}

/**
 * Parts that look like they belong to a script but are not driven by it (M16): the script writes an input, through a
 * group (a tag), on parts of some type, and this part is of that type but the script reaches it through none of its
 * names. The usual cause is a part added in the builder that did not get the group.
 *
 * Conservative on purpose, so it is never a false alarm: nothing at all is reported for a script that builds any
 * target in code (it may reach the part that way), a type the script names anywhere (`set('gun', ...)`,
 * `p.type === 'gun'`) is driven as a type and never flagged, and a part that belongs to another core's scope (a
 * placed missile's own parts) is not the robot's to drive. Under a scope only that scope's members are looked at.
 */
export function undrivenParts(reading: ScriptReading, bp: Blueprint, registry: PartRegistry, scope?: string): UndrivenPart[] {
  if (reading.buildsTargets) return [];
  const reach = scriptReach(reading, bp, registry, scope);
  const reached = new Set(reach.flatMap((r) => r.parts));
  const named = new Set(reading.names.map((n) => n.name));
  /** Per part type: each input the script writes on it, with the groups it writes it through. */
  const written = new Map<string, Map<string, string[]>>();
  const byId = new Map(bp.parts.map((p) => [p.id, p]));
  for (const r of reach) {
    const channel = r.name.channel;
    if (r.name.use !== 'set' || channel === undefined) continue;
    for (const id of r.parts) {
      const p = byId.get(id);
      // Written through a group: by its type every part of the type is reached, and by its id only that one is meant.
      if (!p || r.name.name === p.part || r.name.name === p.id || !channelNames(registry, p.part, false).includes(channel)) continue;
      const inputs = written.get(p.part) ?? new Map<string, string[]>();
      const groups = inputs.get(channel) ?? [];
      if (!groups.includes(r.name.name)) groups.push(r.name.name);
      inputs.set(channel, groups);
      written.set(p.part, inputs);
    }
  }
  const otherScopes = (bp.cores ?? []).flatMap((c) => (c.scope !== undefined && c.scope !== scope ? [c.scope] : []));
  const out: UndrivenPart[] = [];
  for (const p of bp.parts) {
    const inputs = written.get(p.part);
    if (!inputs || reached.has(p.id) || named.has(p.part)) continue;
    if (scope !== undefined ? !p.tags.includes(scope) : otherScopes.some((s) => p.tags.includes(s))) continue;
    const groups: string[] = [];
    for (const g of inputs.values()) for (const name of g) if (!groups.includes(name)) groups.push(name);
    out.push({ part: p.id, type: p.part, inputs: [...inputs.keys()], groups: groups.map((name) => ({ name, tag: scope !== undefined ? `${scope}.${name}` : name })) });
  }
  return out;
}

/** A place a script names a part id as a plain string. */
export interface IdMention extends SourceSpot {
  /** The script's id, and who runs it (`ScriptRun.label`). */
  script: string;
  label: string;
  id: string;
}

/**
 * Where the blueprint's scripts name any of the given part ids as a plain string (anywhere in the code, not only in
 * `set()` and `get()`). `moveParts` and `replacePartType` follow an id through the blueprint but never rewrite script
 * code: this tells a caller which scripts still spell the old id, and exactly where.
 */
export function scriptIdMentions(bp: Blueprint, ids: readonly string[]): IdMention[] {
  const out: IdMention[] = [];
  for (const run of scriptRuns(bp)) {
    if (typeof run.script.source !== 'string') continue;
    for (const t of tokens(run.script.source)) if (t.kind === 'string' && ids.includes(t.text)) out.push({ script: run.script.id, label: run.label, id: t.text, ...spot(t) });
  }
  return out;
}

/** One thing that drives, reads, or tests for a part. */
export interface PartDriver {
  /** A key binding, a script's `set()` or `get()`, or a script's own test (`p.type === 'x'`, `tags.includes('x')`). */
  kind: 'binding' | 'set' | 'get' | 'test';
  /** How it names the part: by its part type, by one of its tags, or by its id. */
  via: 'type' | 'tag' | 'id';
  /** The name as written. */
  name: string;
  /** Who runs it (`ScriptRun.label`; '' for the robot's own controls). */
  label: string;
  /** The binding's key. */
  key?: string;
  /** The script's id, and where in its code. */
  script?: string;
  at?: SourceSpot;
  /** The input it writes (a binding, a `set`) or the value it reads (a `get`), when known. */
  channel?: string;
}

export interface PartDrivers {
  /** Everything that reaches the part by a plain name, in blueprint order. */
  drivers: PartDriver[];
  /**
   * Whether a binding, a `set()` or a `get()` names it by its part type: after a swap to another type those no longer
   * reach it, unless the new part keeps the old type's name as a tag (`ReplaceOptions.keepTypeTag`).
   */
  byType: boolean;
  /**
   * Scripts that test for its part type in their own code (`p.type === 'thruster'`). A tag does not satisfy these: after
   * a swap such a script skips the new part whatever its tags, and only an edit to the script changes that.
   */
  typeTests: PartDriver[];
  /** Scripts that build targets in code and so may reach the part in ways not listed here. */
  buildsTargets: { script: string; label: string }[];
  /**
   * With `newType`: the drivers that use an input (for a `get`, an input or an output) the new part type lacks. They
   * would reach the swapped part and do nothing on it.
   */
  missing: PartDriver[];
}

/**
 * What drives one part, and by which name (M16, before and after a swap): every binding and every plain script name
 * that reaches it, under each core's own scope. With `newType`, also which of those use an input the new type lacks.
 * Auto controls are not listed (they are worked out from the part, whatever it becomes).
 */
export function partDrivers(bp: Blueprint, registry: PartRegistry, id: string, newType?: string): PartDrivers {
  const out: PartDrivers = { drivers: [], byType: false, typeTests: [], buildsTargets: [], missing: [] };
  const part = bp.parts.find((p) => p.id === id);
  if (!part) return out;
  const via = (name: string): PartDriver['via'] => (name === part.id ? 'id' : name === part.part ? 'type' : 'tag');
  const reaches = (name: string, scope: string | undefined): boolean => matchesTarget(view(part, registry, scope), name);
  const bindings = (list: readonly Binding[], scope: string | undefined, label: string): void => {
    for (const b of list) {
      if (b.target === undefined || !reaches(b.target, scope)) continue;
      out.drivers.push({ kind: 'binding', via: via(b.target), name: b.target, label, key: b.key, ...(b.channel !== undefined ? { channel: b.channel } : {}) });
    }
  };
  const scripts = (list: readonly ScriptSpec[], scope: string | undefined, label: string): void => {
    for (const s of list) {
      if (typeof s.source !== 'string') continue;
      const reading = readScript(s.source);
      if (reading.buildsTargets) out.buildsTargets.push({ script: s.id, label });
      for (const n of reading.names) {
        if (!reaches(n.name, scope)) continue;
        const kind = n.use === 'set' || n.use === 'get' ? n.use : 'test';
        const { name, use: _use, channel, channelAt: _channelAt, ...at } = n;
        const d: PartDriver = { kind, via: via(name), name, label, script: s.id, at, ...(channel !== undefined ? { channel } : {}) };
        out.drivers.push(d);
        if (kind === 'test' && d.via === 'type') out.typeTests.push(d);
      }
    }
  };
  bindings(bp.bindings, undefined, '');
  scripts(bp.scripts, undefined, '');
  for (const c of bp.cores ?? []) {
    const label = `core ${c.core}${c.scope !== undefined ? ` (${c.scope})` : ''}: `;
    bindings(c.bindings, c.scope, label);
    scripts(c.scripts, c.scope, label);
  }
  out.byType = out.drivers.some((d) => d.via === 'type' && d.kind !== 'test');
  if (newType !== undefined) {
    out.missing = out.drivers.filter((d) => d.kind !== 'test' && d.channel !== undefined && !channelNames(registry, newType, d.kind === 'get').includes(d.channel));
  }
  return out;
}

const MAX_LISTED = 8;

function listed(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(', ');
  return names.length > MAX_LISTED ? `${shown}, and ${names.length - MAX_LISTED} more` : shown;
}

/**
 * What is surely wrong with the names one script uses, as warnings (a robot with a script that reaches nothing still
 * spawns): `SCRIPT_TARGET` for a plain `set()` or `get()` target that reaches nothing on the robot (M16: a part type
 * the robot lacks included), with the line and the real names, nearest first; `SCRIPT_CHANNEL` for an input or output
 * none of the reached parts has, or, when the target is built in code, that no part type at all has. Targets built in
 * code are never guessed at. Each message starts with the script's name (`script 'hover' (drone.hover.js)`).
 */
export function scriptNameIssues(run: ScriptRun, registry: PartRegistry): Issue[] {
  const source = run.script.source;
  if (typeof source !== 'string') return [];
  const issues: (Issue & { at: number })[] = [];
  const who = `${run.label}script '${run.script.id}'${run.script.file !== undefined ? ` (${run.script.file})` : ''}`;
  const warn = (code: string, at: SourceSpot, message: string): void => {
    issues.push({ severity: 'warning', code, message: `${who} line ${at.line}: ${message}`, at: at.start });
  };
  const hint = (word: string, among: readonly string[]): string => {
    const near = nearestNames(word, among)[0];
    return near !== undefined ? `; did you mean '${near}'?` : '';
  };
  const what = (reads: boolean): string => (reads ? 'reads a value' : 'writes an input');
  const reading = readScript(source);
  const bp = run.blueprint;

  for (const b of reading.built) {
    // The target is worked out at run time: only a channel no part type at all has is surely a mistake.
    if (b.channel === undefined) continue;
    const reads = b.fn === 'get';
    const every = [...new Set(registry.ids().flatMap((t) => channelNames(registry, t, reads)))];
    if (!every.includes(b.channel)) warn('SCRIPT_CHANNEL', b, `${b.fn}(..., '${b.channel}') ${what(reads)} no part has${hint(b.channel, every)}`);
  }

  const dead = new Map(deadNames(reading, bp, registry, run.scope).map((d) => [d.start, d]));
  for (const r of scriptReach(reading, bp, registry, run.scope)) {
    const n = r.name;
    if (n.use !== 'set' && n.use !== 'get') continue;
    const d = dead.get(n.start);
    if (d) {
      const known = namesAvailable(bp, registry, run.scope);
      const order = (names: readonly string[]): string[] => d.available.filter((a) => names.includes(a));
      const mean = d.nearest !== undefined ? `; did you mean '${d.nearest}'?` : '';
      warn('SCRIPT_TARGET', n, `${n.use}('${n.name}', ...) reaches nothing: no part has that tag, part type, or id${mean} (tags here: ${listed(order(known.tags)) || 'none'}; part types here: ${listed(order(known.types)) || 'none'})`);
      continue;
    }
    if (n.channel === undefined || r.channelFound !== false) continue;
    const reads = n.use === 'get';
    const channel = n.channel;
    const reached = bp.parts.filter((p) => r.parts.includes(p.id));
    const types = reached.length > 0 ? [...new Set(reached.map((p) => p.part))] : [n.name];
    const list = (t: string): string => {
      const ins = `inputs: ${channelNames(registry, t, false).join(', ') || 'none'}`;
      return reads ? `${ins}; outputs: ${registry.get(t).outputs.map((ch) => ch.name).join(', ') || 'none'}` : ins;
    };
    const kinds = types.map((t) => `a ${t}`).join(' or ');
    warn('SCRIPT_CHANNEL', n, `${n.use}('${n.name}', '${channel}') ${what(reads)} ${kinds} does not have${hint(channel, types.flatMap((t) => channelNames(registry, t, reads)))} (${types.map((t) => (types.length > 1 ? `${t} ` : '') + list(t)).join('; ')})`);
  }
  // In the order written, as the old check reported them.
  return issues.sort((a, b) => a.at - b.at).map(({ at: _at, ...i }) => i);
}
