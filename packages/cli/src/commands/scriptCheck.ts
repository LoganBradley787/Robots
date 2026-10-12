import { defaultRegistry, editDistance, nearestNames, scopeBase, validateBlueprint, type Blueprint, type Issue, type PartRegistry, type PlacedPart, type ScriptSpec } from '@robots/sim-core';
import { scriptHost } from '../scriptHost';

/**
 * What `validate` says about a blueprint's scripts (review T2), all warnings: a robot with a broken script still
 * spawns, the script just stops at t=0. Each script is compiled as the world compiles it (`SCRIPT_SYNTAX`,
 * `SCRIPT_NO_TICK`, `SCRIPT_ERROR`), and the plain strings it passes to `set()` and `get()` are checked against the
 * robot's tags, part types, part ids, and channel names (`SCRIPT_TARGET`, `SCRIPT_CHANNEL`), saying something only
 * when it is surely a mistake. Lives in the CLI because
 * it needs QuickJS, which `sim-core`'s validator must not load. Empty when the blueprint itself cannot be read.
 */
export async function scriptIssues(raw: unknown): Promise<Issue[]> {
  const registry = defaultRegistry();
  const v = validateBlueprint(raw, registry);
  if (!v.blueprint) return [];
  const host = await scriptHost();
  const issues: Issue[] = [];
  const robot = everyPart(v.blueprint);
  const copies = copyNames(robot, registry);
  for (const { script, label } of labeled(v.blueprint, '')) {
    if (typeof script.source !== 'string') continue;
    const name = `${label}script '${script.id}'${script.file !== undefined ? ` (${script.file})` : ''}`;
    const warn = (code: string, message: string): void => {
      issues.push({ severity: 'warning', code, message: `${name} ${message}` });
    };
    const compiled = host.compile(script.source, { name: script.file ?? script.id, seed: 1, params: script.params });
    if (compiled.ok) compiled.instance.dispose();
    else if (compiled.error.kind !== 'compile') warn('SCRIPT_ERROR', `stops as it starts: ${compiled.error.message}`);
    else if (compiled.error.message.endsWith('does not define function tick()')) warn('SCRIPT_NO_TICK', 'does not define function tick() and would stop at t=0');
    else warn('SCRIPT_SYNTAX', `does not compile and would stop at t=0: ${compiled.error.message}`);
    // A script that does not parse has no calls worth reading.
    if (!compiled.ok && compiled.error.kind === 'compile' && !compiled.error.message.endsWith('tick()')) continue;
    const used = plainStrings(script.source);
    for (const c of calls(script.source)) checkCall(c, robot, copies, used, registry, (code, message) => warn(code, `line ${c.line}: ${message}`));
  }
  return issues;
}

/** Every script with who runs it: the primary core's, each other core's, then each recipe's (and theirs). */
function labeled(bp: Blueprint, label: string): { script: ScriptSpec; label: string }[] {
  return [
    ...bp.scripts.map((script) => ({ script, label })),
    ...(bp.cores ?? []).flatMap((c) => c.scripts.map((script) => ({ script, label: `${label}core ${c.core}${c.scope !== undefined ? ` (${c.scope})` : ''}: ` }))),
    ...(bp.recipes ?? []).flatMap((r) => labeled(r.blueprint, `${label}recipe ${r.name}: `)),
  ];
}

/** The robot's parts and those of everything its bays build: a script may reach any of them at some point of a run. */
function everyPart(bp: Blueprint): PlacedPart[] {
  return [...bp.parts, ...(bp.recipes ?? []).flatMap((r) => everyPart(r.blueprint))];
}

/** Names of copies a bay builds at run time (`bay1`, `bay2`, ...: `scopeBase`), which no part carries in the file. */
function copyNames(parts: readonly PlacedPart[], registry: PartRegistry): RegExp[] {
  const out: RegExp[] = [];
  for (const p of parts) {
    const base = p.makes !== undefined && registry.has(p.part) ? scopeBase(p, registry.get(p.part)) : undefined;
    // The base as written and as a scoped core sees it (`fab1.bay` is `bay` inside fab1).
    for (const b of base === undefined ? [] : names(base)) out.push(new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+($|\\.)`));
  }
  return out;
}

/** A tag and every way a scoped core may see it: `missile1.fins` is also `fins` to missile1's own scripts (`scopedView`). */
function names(tag: string): string[] {
  const out = [tag];
  for (let i = tag.indexOf('.'); i >= 0; i = tag.indexOf('.', i + 1)) out.push(tag.slice(i + 1));
  return out;
}

/** Whether a part may answer to `target` for some core of the robot. Generous on purpose: a warning must be sure. */
function answers(p: PlacedPart, target: string, registry: PartRegistry): boolean {
  if (p.part === target || p.id === target) return true;
  const tags = [...p.tags, ...(registry.has(p.part) ? (registry.get(p.part).defaultTags ?? []) : [])];
  return tags.some((t) => names(t).includes(target));
}

type Warn = (code: string, message: string) => void;

function checkCall(c: Call, robot: readonly PlacedPart[], copies: readonly RegExp[], used: ReadonlySet<string>, registry: PartRegistry, warn: Warn): void {
  const reads = c.fn === 'get';
  const channelsOf = (part: string): string[] => {
    const def = registry.get(part);
    return [...def.inputs, ...(reads ? def.outputs : [])].map((ch) => ch.name);
  };
  const what = reads ? 'reads a value' : 'writes an input';
  const hint = (word: string, among: readonly string[]): string => {
    const near = nearestNames(word, among)[0];
    return near !== undefined ? `; did you mean '${near}'?` : '';
  };
  if (c.target === undefined) {
    // The target is worked out at run time: only a channel no part type at all has is surely a mistake.
    if (c.channel === undefined) return;
    const every = [...new Set(registry.ids().flatMap(channelsOf))];
    if (!every.includes(c.channel)) warn('SCRIPT_CHANNEL', `${c.fn}(..., '${c.channel}') ${what} no part has${hint(c.channel, every)}`);
    return;
  }
  const target = c.target;
  // A part type the robot lacks is left alone: a script shared between robots drives `warhead` and `heavywarhead` alike.
  if (copies.some((re) => re.test(target)) || registry.has(target)) return;
  const reached = robot.filter((p) => answers(p, target, registry));
  if (reached.length === 0) {
    // A name no part has is not by itself a mistake: stock scripts are shared between robots and reach for a tag
    // (`dprop`, `bay`) only some of them carry. It is one when it is a letter or two from a name the robot has that
    // the script never uses: `wheelz` on a robot tagged `wheels`.
    const known = [...new Set([...robot.flatMap((p) => p.tags.flatMap(names)), ...robot.map((p) => p.part), ...robot.map((p) => p.id)])];
    const near = nearestNames(target, known, known.length).filter((n) => editDistance(target, n) <= 2);
    if (near[0] !== undefined && !near.some((n) => used.has(n))) warn('SCRIPT_TARGET', `${c.fn}('${target}', ...) reaches nothing: no part has that tag, part type, or id; did you mean '${near[0]}'?`);
    return;
  }
  if (c.channel === undefined) return;
  const channel = c.channel;
  const types = [...new Set(reached.map((p) => p.part))];
  if (types.some((t) => channelsOf(t).includes(channel))) return;
  const list = (t: string): string => {
    const def = registry.get(t);
    const ins = `inputs: ${def.inputs.map((ch) => ch.name).join(', ') || 'none'}`;
    return reads ? `${ins}; outputs: ${def.outputs.map((ch) => ch.name).join(', ') || 'none'}` : ins;
  };
  const kinds = types.map((t) => `a ${t}`).join(' or ');
  warn('SCRIPT_CHANNEL', `${c.fn}('${target}', '${channel}') ${what} ${kinds} does not have${hint(channel, types.flatMap(channelsOf))} (${types.map((t) => (types.length > 1 ? `${t} ` : '') + list(t)).join('; ')})`);
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
  let i = 0;
  /** From the opening quote at `i` to just past the closing one; counts lines, and for a template walks `${ ... }`. */
  const skipQuoted = (): void => {
    const quote = src[i];
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\n') line++;
      if (src[i] === '\\') i++;
      else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        for (let depth = 1; i < src.length && depth > 0; ) {
          const ch = src[i];
          if (ch === "'" || ch === '"' || ch === '`') {
            skipQuoted();
            continue;
          }
          if (ch === '\n') line++;
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
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === '\n') line++;
    } else if (ch === "'" || ch === '"') {
      const start = i;
      const at = line;
      skipQuoted();
      const body = src.slice(start + 1, i - 1);
      // A string with an escape in it is left as not plain, so nothing is claimed about what it spells.
      out.push(body.includes('\\') ? { kind: 'other', text: 'string', line: at } : { kind: 'string', text: body, line: at });
    } else if (ch === '`') {
      const at = line;
      skipQuoted();
      out.push({ kind: 'other', text: 'template', line: at });
    } else if (ch === '/') {
      const prev = out[out.length - 1];
      const divides = prev !== undefined && (prev.kind === 'word' ? !BEFORE_REGEX.has(prev.text) : prev.kind === 'string' || /^[)\]}]$|^(number|string|template|regex)$/.test(prev.text));
      if (divides) {
        out.push({ kind: 'other', text: '/', line });
        i++;
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
      out.push({ kind: 'other', text: 'regex', line });
    } else if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < src.length && /[\w$]/.test(src[i] ?? '')) i++;
      out.push({ kind: 'word', text: src.slice(start, i), line });
    } else if (/[0-9]/.test(ch)) {
      while (i < src.length && /[\w.]/.test(src[i] ?? '')) i++;
      out.push({ kind: 'other', text: 'number', line });
    } else {
      out.push({ kind: 'other', text: ch, line });
      i++;
    }
  }
  return out;
}

/** Every plain string a script writes anywhere: the names it means to use. */
export function plainStrings(source: string): Set<string> {
  return new Set(tokens(source).flatMap((t) => (t.kind === 'string' ? [t.text] : [])));
}

/** Every call of the script API's `set` and `get` in a script's code, in order. Methods (`map.get`) are not calls of it. */
export function calls(source: string): Call[] {
  const t = tokens(source);
  const is = (k: number, text: string): boolean => t[k]?.kind === 'other' && t[k]?.text === text;
  // A script that defines its own `set` or `get` means something else by it.
  const own = new Set<string>();
  for (let k = 0; k < t.length; k++) {
    const w = t[k];
    if (w?.kind !== 'word' || (w.text !== 'set' && w.text !== 'get')) continue;
    const before = t[k - 1];
    if ((before?.kind === 'word' && ['function', 'const', 'let', 'var'].includes(before.text)) || (is(k + 1, '=') && !is(k + 2, '=') && !is(k - 1, '.'))) own.add(w.text);
  }
  const out: Call[] = [];
  for (let k = 0; k < t.length; k++) {
    const w = t[k];
    if (w?.kind !== 'word' || (w.text !== 'set' && w.text !== 'get') || own.has(w.text) || !is(k + 1, '(') || is(k - 1, '.')) continue;
    const call: Call = { fn: w.text, line: w.line };
    // Each argument: from `from` to the comma or closing bracket that ends it. Plain when it is one string and no more.
    const arg = (from: number): { plain?: string; end: number } => {
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
      return { ...(end === from + 1 && first?.kind === 'string' ? { plain: first.text } : {}), end };
    };
    const target = arg(k + 2);
    if (target.plain !== undefined) call.target = target.plain;
    if (is(target.end, ',')) {
      const channel = arg(target.end + 1);
      if (channel.plain !== undefined) call.channel = channel.plain;
    }
    out.push(call);
  }
  return out;
}
