import { AUTO_KEYS, type ControlTrace, type ScriptError, type TraceInput } from '@robots/sim-core';
import { msText } from '../app/scriptCosts';
import { runsText } from '../app/scriptScheduler';

/**
 * The live readout of one robot in the world (M16, plan section 7), as plain text lines: each script running, off or
 * crashed with the message and line of a crash, the keys it reads, its last log lines and what it set this tick; for
 * each input a key or a script drives, who is driving it right now, with the values; and each held key a running script
 * reads. Pure: the world's trace in, sentences out.
 */

export interface ReadoutScript {
  id: string;
  state: 'on' | 'off' | 'crashed';
  /** A crash: what went wrong, and where. */
  error?: string;
  line?: number;
  /** Running, the keys it has asked about ("reads W A S D"), when any. */
  reads?: string;
  /** Its last log lines, oldest first. */
  logs: string[];
  /** What it set this tick, one line per input (several parts with one input are one line). */
  sets: { text: string; bad?: boolean }[];
}

export interface ReadoutInput {
  /** "4 propellers, throttle". */
  what: string;
  /** "W is held: the key's 100% beats hover's 54%". */
  says: string;
  source: 'key' | 'script' | 'default';
}

export interface ReadoutView {
  /** The robot's name, and whether it is only watched (an enemy, or one of yours you do not control). */
  robot: string;
  watching: boolean;
  scripts: ReadoutScript[];
  inputs: ReadoutInput[];
  /** Held keys a running script reads: "W is held: hover reads it.". */
  held: string[];
  /**
   * What its scripts cost on this machine: "scripts 1.4 ms a tick", or with Smooth skipping them "scripts 4.2 ms a
   * run, runs 1 tick in 3". Absent until they have run.
   */
  cost?: string;
}

export interface ReadoutSource {
  robot: string;
  watching: boolean;
  /** `reads`: the keys each has asked about since it was switched on. */
  scripts: ReadonlyArray<{ id: string; enabled: boolean; crashed?: ScriptError; reads?: readonly string[] }>;
  /** Whether a key is held, for the robot you control; undefined when you only watch it. */
  held?(key: string): boolean;
  /** The robot's log lines, oldest first. */
  logs: ReadonlyArray<{ script: string; text: string }>;
  /** The trace of its last tick; undefined when the world has none (nothing ticked yet, or the robot has no core). */
  trace?: ControlTrace;
  /** Wall-clock ms its scripts take per run, smoothed (`ScriptCosts`); undefined before they ran. */
  cost?: number;
  /** Smooth: how many of its recent ticks its scripts ran (`ScriptScheduler.rate`); undefined with Smooth off. */
  rate?: { ran: number; of: number };
  /** A part's type by its id, and a type's name as its definition gives it ("propeller"). */
  typeOf(partId: string): string | undefined;
  typeName(type: string): string;
}

const LOGS_SHOWN = 4;
const SETS_SHOWN = 6;

const num = (v: number): string => String(Number(v.toFixed(2)));

/** A value as a share of the input's full swing: 0.54 of 0 to 1 is 54%, -1 of -1 to 1 is -100%. */
export function percentOf(v: number, c: { min: number; max: number }): string {
  const full = Math.max(Math.abs(c.min), Math.abs(c.max));
  if (full === 0) return num(v);
  return `${Math.round((v / full) * 100)}%`;
}

const keyCap = (key: string): string => (key.length === 1 ? key.toUpperCase() : key);

/** Keys in the keys bar's order: the auto control keys first (Q W E A S D), then the others as first read. */
function inKeyOrder(keys: readonly string[]): string[] {
  const rank = (k: string): number => (AUTO_KEYS.includes(k) ? AUTO_KEYS.indexOf(k) : AUTO_KEYS.length);
  return keys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "54%", or "52% to 56%" when the parts differ. */
function spread(values: readonly string[]): string {
  const first = values[0] ?? '';
  const numbers = values.map((v) => Number.parseFloat(v));
  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);
  if (values.every((v) => v === first) || !Number.isFinite(lo)) return first;
  const unit = first.endsWith('%') ? '%' : '';
  return `${num(lo)}${unit} to ${num(hi)}${unit}`;
}

function counted(n: number, name: string): string {
  return n === 1 ? name : `${n} ${name}s`;
}

/** Who drives a set of inputs that share a source, in one sentence. */
function says(group: TraceInput[]): string {
  const first = group[0] as TraceInput;
  const value = spread(group.map((i) => percentOf(i.value, i)));
  const active = first.keys.filter((k) => k.active);
  const idle = first.keys.filter((k) => !k.active);
  const scripted = first.script !== undefined ? spread(group.map((i) => percentOf(i.script?.value ?? 0, i))) : undefined;
  const would = idle.length > 0 ? ` ${listed([...new Set(idle.map((k) => keyCap(k.key)))])} would take over.` : '';
  if (first.source === 'key') {
    const names = [...new Set(active.map((k) => keyCap(k.key)))];
    const how = active.every((k) => k.mode === 'toggle') ? 'switched on' : active.every((k) => k.mode === 'pulse') ? 'tapped' : 'held';
    const who = `${listed(names)} ${names.length === 1 ? 'is' : 'are'} ${how}`;
    const key = names.length === 1 ? "the key's" : "the keys'";
    if (first.script !== undefined) return `${who}: ${key} ${value} beats ${first.script.id}'s ${scripted}.`;
    return `${who}: ${value}.`;
  }
  if (first.source === 'script') return `${first.script?.id ?? 'a script'} sets it: ${value}.${would}`;
  return `Nothing drives it now: it rests at ${value}.${would}`;
}

/** What one script set this tick, a line per input: its writes to single parts folded together, its named ones one each. */
function setsOf(script: string, trace: ControlTrace, src: ReadoutSource): ReadoutScript['sets'] {
  const out: ReadoutScript['sets'] = [];
  const byPart = new Map<string, number[]>();
  for (const w of trace.writes) {
    if (w.script !== script) continue;
    if (src.typeOf(w.target) !== undefined) {
      // A single part by its id: folded with the others of its kind.
      const key = `${src.typeName(src.typeOf(w.target) as string)}\0${w.channel}`;
      byPart.set(key, [...(byPart.get(key) ?? []), w.value]);
    } else if (w.parts === 0) out.push({ text: `${w.channel} on "${w.target}": nothing answers to that name`, bad: true });
    else out.push({ text: `${w.channel} on "${w.target}" (${w.parts} part${w.parts === 1 ? '' : 's'}): ${num(w.value)}` });
  }
  const folded: ReadoutScript['sets'] = [...byPart].map(([key, values]) => {
    const [name = '', channel = ''] = key.split('\0');
    return { text: `${channel} on ${counted(values.length, name)}: ${spread(values.map(num))}` };
  });
  const all = [...folded, ...out];
  return all.length > SETS_SHOWN ? [...all.slice(0, SETS_SHOWN - 1), { text: `and ${all.length - SETS_SHOWN + 1} more` }] : all;
}

export function buildReadout(src: ReadoutSource): ReadoutView {
  const trace = src.trace;
  const scripts = src.scripts.map((s): ReadoutScript => {
    const line = s.crashed ? /\(line (\d+)\)/.exec(s.crashed.message)?.[1] : undefined;
    return {
      id: s.id,
      state: s.enabled ? 'on' : s.crashed ? 'crashed' : 'off',
      ...(s.crashed ? { error: s.crashed.message.replace(/\s*\(line \d+\)\s*$/, '') } : {}),
      ...(line !== undefined ? { line: Number(line) } : {}),
      ...(s.enabled && s.reads && s.reads.length > 0 ? { reads: `reads ${inKeyOrder(s.reads).map(keyCap).join(' ')}` } : {}),
      logs: src.logs.filter((l) => l.script === s.id).slice(-LOGS_SHOWN).map((l) => l.text),
      sets: trace && s.enabled ? setsOf(s.id, trace, src) : [],
    };
  });
  // Inputs that are driven the same way are one line: the four lifters, not each of them.
  const groups = new Map<string, TraceInput[]>();
  for (const i of trace?.inputs ?? []) {
    const type = src.typeOf(i.part) ?? i.part;
    const key = [type, i.channel, i.source, i.keys.map((k) => `${k.key}${k.mode}${k.active ? '+' : '-'}`).join(','), i.script?.id ?? ''].join('\0');
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const rank = { key: 0, script: 1, default: 2 } as const;
  const named = (g: TraceInput[]): string => {
    const first = g[0] as TraceInput;
    const type = src.typeOf(first.part);
    return `${counted(g.length, type !== undefined ? src.typeName(type) : first.part)}, ${first.channel}`;
  };
  const all = [...groups.values()];
  const inputs = all
    .map((g): ReadoutInput => {
      const first = g[0] as TraceInput;
      // Two lines that would read the same (one propeller on a key, one not) name their parts instead.
      const clash = all.some((o) => o !== g && named(o) === named(g));
      const what = clash && g.length <= 2 ? `${g.map((i) => i.part).join(' and ')}, ${first.channel}` : named(g);
      return { what, says: says(g), source: first.source };
    })
    .sort((a, b) => rank[a.source] - rank[b.source]);
  const cost = costText(src);
  return { robot: src.robot, watching: src.watching, scripts, inputs, held: heldReads(src), ...(cost !== undefined ? { cost } : {}) };
}

/** "scripts 1.4 ms a tick", while any script runs. */
function costText(src: ReadoutSource): string | undefined {
  if (src.cost === undefined || !src.scripts.some((s) => s.enabled)) return undefined;
  const runs = runsText(src.rate);
  return runs === undefined ? `scripts ${msText(src.cost)} a tick` : `scripts ${msText(src.cost)} a run, ${runs}`;
}

/** Held keys that running scripts read, one line for the keys the same scripts read: "W and A are held: hover reads them.". */
function heldReads(src: ReadoutSource): string[] {
  const held = src.held;
  if (!held) return [];
  const readers = new Map<string, string[]>();
  for (const s of src.scripts) {
    if (!s.enabled) continue;
    for (const k of s.reads ?? []) if (held(k)) readers.set(k, [...(readers.get(k) ?? []), s.id]);
  }
  const byWho = new Map<string, { ids: string[]; keys: string[] }>();
  for (const k of inKeyOrder([...readers.keys()])) {
    const ids = readers.get(k) as string[];
    const who = byWho.get(ids.join('\0')) ?? { ids, keys: [] };
    who.keys.push(keyCap(k));
    byWho.set(ids.join('\0'), who);
  }
  return [...byWho.values()].map(({ ids, keys }) => {
    const many = keys.length > 1;
    return `${listed(keys)} ${many ? 'are' : 'is'} held: ${listed(ids)} ${ids.length > 1 ? 'read' : 'reads'} ${many ? 'them' : 'it'}.`;
  });
}
