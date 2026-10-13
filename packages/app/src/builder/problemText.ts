import { editDistance, readScript, rootPartId, type Blueprint, type PartRegistry } from '@robots/sim-core';
import type { NameFix, ScriptPlace, ScriptProblem } from './scriptView';

/**
 * Problems, said short (M16): each problem is one line in the strip (who, what), and its full message shows when the
 * row is opened. Also the rule for when a dead name's "point it at X" may be offered at all.
 */

/**
 * A validator message cut to its first clause, for the one line a problem gets. The whole message is one click away,
 * so this only has to say what is wrong, not how to fix it.
 */
export function issueLine(message: string): string {
  const text = message.trim();
  // The first place a sentence, a clause or an aside ends, when enough stands before it to mean something.
  const cut = [text.indexOf('. '), text.indexOf('; '), text.indexOf(': '), text.indexOf(' (')].filter((i) => i >= 14);
  const at = cut.length > 0 ? Math.min(...cut) : -1;
  return at < 0 ? text.replace(/\.$/, '') : text.slice(0, at);
}

/** `script 'pilot' (file.js) line 211: get('bay', ...) reaches nothing: ...` taken apart. */
const SCRIPT_MESSAGE = /^(.*?)script '([^']*)'(?: \([^)]*\))? line (\d+): (set|get)\((?:'([^']*)'|\.\.\.), (?:'([^']*)'|\.\.\.)\) (.*)$/s;

/**
 * One script problem as one short line: "pilot, line 211: 'bay' reaches nothing". Who is the script (and whose it
 * is, for a placed robot's own core); what is the name or the input that is wrong. A message in a shape this does not
 * know falls back to its first clause.
 */
export function problemLine(p: Pick<ScriptProblem, 'code' | 'message'>): string {
  const m = SCRIPT_MESSAGE.exec(p.message);
  if (!m) return issueLine(p.message);
  const [, label = '', id = '', line = '', fn = '', name, channel, rest = ''] = m;
  const whose = label.replace(/:\s*$/, '').trim();
  const who = `${id}${whose !== '' ? ` (${whose})` : ''}, line ${line}`;
  const copies = Number(/; the same in (\d+) more cop(?:y|ies) of this script/.exec(rest)?.[1]);
  const many = Number.isFinite(copies) ? `, in ${copies + 1} copies` : '';
  if (p.code === 'SCRIPT_TARGET' && name !== undefined) return `${who}: '${name}' reaches nothing${many}`;
  if (p.code === 'SCRIPT_CHANNEL' && channel !== undefined) {
    const what = fn === 'get' ? `nothing to read called '${channel}'` : `no '${channel}' input`;
    return name !== undefined ? `${who}: '${name}' has ${what}${many}` : `${who}: no part has ${fn === 'get' ? `a '${channel}' to read` : `a '${channel}' input`}${many}`;
  }
  return `${who}: ${issueLine(rest)}`;
}

/** The code of the script a fix would rewrite, wherever it lives: the robot's own, a core's, or inside recipes. */
export function scriptSourceAt(bp: Blueprint, registry: PartRegistry, place: ScriptPlace): string | undefined {
  let at: Blueprint | undefined = bp;
  for (const name of place.recipes) at = at?.recipes?.find((r) => r.name === name)?.blueprint;
  if (!at) return undefined;
  const own = place.core === undefined || place.core === rootPartId(at, registry);
  const scripts = own ? at.scripts : (at.cores?.find((c) => c.core === place.core)?.scripts ?? []);
  const source = scripts.find((s) => s.id === place.id)?.source;
  return typeof source === 'string' ? source : undefined;
}

/**
 * Whether "point it at X" may be offered for a dead name (M16): only when X is a near-misspelling of it. That is, at
 * most two letters away, and not a name the same script already uses somewhere else. A script that drives `lprop`
 * and `rprop` and also names a dead `dprop` did not mistype `lprop`: it means a third thing, and pointing it at
 * `lprop` would quietly make two of its lines drive the same parts. Then the only honest offer is to open the script.
 */
export function fixIsSafe(fix: Pick<NameFix, 'from' | 'to'>, source: string | undefined): boolean {
  if (fix.from === fix.to || editDistance(fix.from, fix.to) > 2) return false;
  if (source === undefined) return false;
  return !readScript(source).names.some((n) => n.name === fix.to);
}

/** The fix a problem may offer, by that rule, or undefined. */
export function safeFix(p: ScriptProblem, bp: Blueprint, registry: PartRegistry): NameFix | undefined {
  const fix = p.fix;
  const first = fix?.spots[0];
  if (!fix || !first) return undefined;
  // Every script it would rewrite must pass: copies of one script share their code, so this is one check in practice.
  const sources = new Set(fix.spots.map((s) => scriptSourceAt(bp, registry, s)));
  return [...sources].every((src) => fixIsSafe(fix, src)) ? fix : undefined;
}
