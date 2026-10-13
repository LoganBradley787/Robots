import { calls, defaultRegistry, editDistance, nearestNames, plainStrings, scopeBase, validateBlueprint, type Blueprint, type Call, type Issue, type PartRegistry, type PlacedPart, type ScriptSpec } from '@robots/sim-core';
import { scriptHost } from '../scriptHost';

// Reading a script (its calls, its plain strings) is pure text work and lives in sim-core (`script/reading.ts`), shared with the builder.
export { calls, type Call };

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

