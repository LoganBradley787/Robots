import { scriptChecks, type Blueprint, type PartRegistry, type ScriptError } from '@robots/sim-core';
import { API_MEMBERS, apiDim, SCRIPT_API, type RefTarget, type RobotRef } from './scriptRef';

/**
 * Help while typing in the script view (M16): what to offer at the caret, and what is wrong with the text, both as
 * plain data the editor draws. Completion inside `set("` and `get("` offers this robot's real names, then that name's
 * real inputs or outputs; after `self.` and `keys.` their members; and the API's own names.
 */

export interface Completion {
  /** What is typed in. */
  label: string;
  /** Beside it, short: "group, 4 propellers", "input, 0 to 1". */
  detail: string;
  /** Under it when it is highlighted. */
  info?: string;
  /** What is put in instead of `label`, when that is more than the word. */
  apply?: string;
  /** Sorts groups before kinds before single parts, and the nearest things first. */
  rank: number;
  /** For the icon: a name on this robot, an input, an output, something of the API. */
  kind: 'group' | 'kind' | 'part' | 'input' | 'output' | 'api' | 'member';
  /** Dimmed with this reason: it does nothing on this robot. */
  dim?: string;
}

export interface CompletionResult {
  /** What the choice replaces: from here to `to` (the name or word being typed, all of it). */
  from: number;
  to: number;
  options: Completion[];
  /** `name`: a target of set or get. `channel`: its input or output. `member`: after `self.` or `keys.`. `word`: an API name. */
  where: 'name' | 'channel' | 'member' | 'word';
}

const targetOption = (t: RefTarget, rank: number): Completion => ({
  label: t.name,
  detail: t.kind === 'group' ? `group, ${t.what}` : t.kind === 'kind' ? `kind, ${t.what}` : t.what,
  info: [t.inputs.length > 0 ? `inputs: ${t.inputs.map((c) => c.name).join(', ')}` : 'no inputs', t.outputs.length > 0 ? `reports: ${t.outputs.map((c) => c.name).join(', ')}` : ''].filter((x) => x !== '').join('. '),
  rank,
  kind: t.kind,
});

/** Every target of the reference, groups first. */
export function allTargets(ref: RobotRef): RefTarget[] {
  return [...ref.groups, ...ref.kinds, ...ref.parts];
}

/**
 * What to offer with the caret at `pos`. `inCode` is false when the editor knows the caret is in a comment (nothing
 * is offered) and undefined when it cannot tell. Undefined when there is nothing to offer here.
 */
export function completeAt(source: string, pos: number, ref: RobotRef, registry: PartRegistry, inComment = false): CompletionResult | undefined {
  if (inComment) return undefined;
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  const before = source.slice(lineStart, pos);
  const lineEnd = source.indexOf('\n', pos);
  const after = source.slice(pos, lineEnd < 0 ? source.length : lineEnd);
  /** To the end of the name being typed: up to the closing quote, never past it. */
  const restOfName = (): number => pos + (/^[^"'`\n,)]*/.exec(after)?.[0].length ?? 0);

  // set("name", "inp|   and   get("name", "out|
  const channel = /\b(set|get)\(\s*(["'])([^"'\n]*)\2\s*,\s*(["'])([^"'\n]*)$/.exec(before);
  if (channel) {
    const fn = channel[1] as 'set' | 'get';
    const target = allTargets(ref).find((t) => t.name === channel[3]);
    const from = pos - (channel[5] as string).length;
    const options: Completion[] = [];
    const add = (name: string, kind: 'input' | 'output', detail: string, rank: number): void => {
      if (!options.some((o) => o.label === name)) options.push({ label: name, detail, rank, kind });
    };
    if (target) {
      for (const c of target.inputs) add(c.name, 'input', `input, ${c.range}${c.words !== '' ? `: ${c.words}` : ''}`, 0);
      if (fn === 'get') for (const c of target.outputs) add(c.name, 'output', `reports ${c.range}`, 1);
    } else {
      // The name is not one of this robot's (yet), or is built in code: every input a part here has.
      for (const t of allTargets(ref)) {
        for (const c of t.inputs) add(c.name, 'input', `input, ${c.range}`, 0);
        if (fn === 'get') for (const c of t.outputs) add(c.name, 'output', `reports ${c.range}`, 1);
      }
    }
    return options.length > 0 ? { from, to: restOfName(), options, where: 'channel' } : undefined;
  }

  // set("na|   and   get("na|
  const name = /\b(set|get)\(\s*(["'])([^"'\n]*)$/.exec(before);
  if (name) {
    const reads = name[1] === 'get';
    const from = pos - (name[3] as string).length;
    const usable = (t: RefTarget): boolean => t.inputs.length > 0 || (reads && t.outputs.length > 0);
    const options = [...ref.groups.filter(usable).map((t) => targetOption(t, 0)), ...ref.kinds.filter(usable).map((t) => targetOption(t, 1)), ...ref.parts.filter(usable).map((t) => targetOption(t, 2))];
    return options.length > 0 ? { from, to: restOfName(), options, where: 'name' } : undefined;
  }

  // Inside any other string, nothing: a name being typed there is the writer's own.
  const quotes = before.replace(/\\./g, '').match(/["'`]/g) ?? [];
  let open: string | undefined;
  for (const q of quotes) open = open === undefined ? q : open === q ? undefined : open;
  if (open !== undefined) return undefined;

  // self.|  self.pos.|  keys.|
  const member = /\b((?:self|keys)(?:\.[A-Za-z]+)?)\.([A-Za-z]*)$/.exec(before);
  if (member) {
    const list = API_MEMBERS[member[1] as string];
    if (!list) return undefined;
    const from = pos - (member[2] as string).length;
    return { from, to: pos + (/^\w*/.exec(after)?.[0].length ?? 0), options: list.map((m, i) => ({ label: m.name, detail: m.about, rank: i, kind: 'member' as const })), where: 'member' };
  }

  // A bare word: the API's own names (not after a dot: that is somebody's property).
  const word = /(^|[^\w.$])([A-Za-z_]\w*)$/.exec(before);
  if (word) {
    const from = pos - (word[2] as string).length;
    const seen = new Set<string>();
    const options: Completion[] = [];
    SCRIPT_API.forEach((e, i) => {
      const label = e.name.split('.')[0] as string;
      if (label === 'part' || seen.has(label)) return;
      seen.add(label);
      const whole = !e.name.includes('.');
      const dim = apiDim(e, ref, registry);
      options.push({ label, detail: whole ? e.about : label === 'self' ? 'the robot: pos, vel, angle, angVel, mass, energy' : 'keys.down, keys.pressed, keys.released', ...(whole && e.more !== undefined ? { info: e.more } : {}), rank: i, kind: 'api', ...(dim !== undefined ? { dim } : {}) });
    });
    for (const w of ['tick', 'setup']) options.push({ label: w, detail: w === 'tick' ? 'function tick() runs 60 times a second' : 'function setup() runs when the script is switched on', rank: 100, kind: 'api' });
    return { from, to: pos + (/^\w*/.exec(after)?.[0].length ?? 0), options, where: 'word' };
  }
  return undefined;
}

/** One thing wrong with the script, where it is, and the names that could stand there. */
export interface EditorCheck {
  /** Offsets into the text. `from === to` marks the whole line. */
  from: number;
  to: number;
  /** From 1. */
  line: number;
  severity: 'error' | 'warning';
  kind: 'syntax' | 'target' | 'input' | 'sees' | 'tick' | 'sleep';
  message: string;
  /** One click each: the text the marked spot would become. */
  fixes: { label: string; text: string }[];
}

/** Where a line starts and ends in a text (line numbers from 1). */
function lineSpan(source: string, line: number): { from: number; to: number } {
  let from = 0;
  for (let i = 1; i < line; i++) {
    const next = source.indexOf('\n', from);
    if (next < 0) break;
    from = next + 1;
  }
  const end = source.indexOf('\n', from);
  return { from, to: end < 0 ? source.length : end };
}

/**
 * Every check for the script view: what the sandbox said when it compiled the text (`compiled`: a syntax error, or a
 * throw as the script starts; undefined while it has not answered), then the pure checks of `sim-core` (a name that
 * reaches nothing, an unknown input or output, `contacts` with nothing that sees, no `tick()`), in the order written.
 */
export function editorChecks(source: string, bp: Blueprint, registry: PartRegistry, scope: string | undefined, compiled?: { ok: true } | { ok: false; error: ScriptError }): EditorCheck[] {
  const out: EditorCheck[] = [];
  const noTick = compiled && !compiled.ok && compiled.error.message.endsWith('does not define function tick()');
  if (compiled && !compiled.ok && !noTick) {
    const m = /\(line (\d+)\)\s*$/.exec(compiled.error.message);
    const line = m ? Math.max(1, Number(m[1])) : 1;
    const span = lineSpan(source, line);
    const text = compiled.error.message.replace(/\s*\(line \d+\)\s*$/, '');
    out.push({ ...span, line, severity: 'error', kind: 'syntax', message: compiled.error.kind === 'compile' ? `This does not run: ${text}.` : `It stops as it starts: ${text}.`, fixes: [] });
  }
  for (const c of scriptChecks(source, bp, registry, scope)) {
    const quote = source[c.start] === '"' || source[c.start] === "'" ? (source[c.start] as string) : undefined;
    const fixes = quote !== undefined && (c.kind === 'target' || c.kind === 'input') ? c.suggest.slice(0, 4).map((s) => ({ label: s, text: `${quote}${s}${quote}` })) : [];
    const span = c.kind === 'tick' ? lineSpan(source, 1) : { from: c.start, to: c.end };
    out.push({ ...span, line: c.line, severity: 'warning', kind: c.kind, message: c.message, fixes });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.from - b.from : a.severity === 'error' ? -1 : 1));
}

/**
 * Where a one-click fix from the list under the code goes in the text as it is now. The list was worked out on
 * `checked`; when the text is still that, the check's own offsets hold. When it changed (a fix just applied, a key
 * typed), the text is checked again (`recheck`) and the fix goes where the same problem is now; when that problem is
 * gone, nowhere, so a second click on a fix never writes into the wrong place.
 */
export function placeFix(c: EditorCheck, label: string, checked: string | undefined, now: string, recheck: (text: string) => readonly EditorCheck[]): { from: number; to: number; insert: string } | undefined {
  const at = now === checked ? c : (() => {
    const same = recheck(now).filter((x) => x.kind === c.kind && x.message === c.message && x.fixes.some((f) => f.label === label));
    return same.find((x) => x.line === c.line) ?? same[0];
  })();
  const fix = at?.fixes.find((f) => f.label === label);
  return at && fix ? { from: at.from, to: at.to, insert: fix.text } : undefined;
}
