import { calls, defaultRegistry, scriptNameIssues, scriptRuns, validateBlueprint, type Call, type Issue } from '@robots/sim-core';
import { scriptHost } from '../scriptHost';

// Reading a script (its calls, its names, what they reach) is pure text work and lives in sim-core (`script/reading.ts`), shared with the builder.
export { calls, type Call };

/**
 * What `validate` says about a blueprint's scripts (review T2), all warnings: a robot with a broken script still
 * spawns, the script just stops at t=0. Each script is compiled as the world compiles it (`SCRIPT_SYNTAX`,
 * `SCRIPT_NO_TICK`, `SCRIPT_ERROR`), and the plain strings it passes to `set()` and `get()` are checked against the
 * robot's tags, part types, part ids, and channel names as the script's own core sees them (`SCRIPT_TARGET`,
 * `SCRIPT_CHANNEL`: `scriptNameIssues` in sim-core). Since M16 a plain name that reaches nothing is always said, a
 * part type the robot lacks included; a target built in code is never guessed at. The compiling lives in the CLI
 * because it needs QuickJS, which `sim-core`'s validator must not load. Empty when the blueprint itself cannot be read.
 */
export async function scriptIssues(raw: unknown): Promise<Issue[]> {
  const registry = defaultRegistry();
  const v = validateBlueprint(raw, registry);
  if (!v.blueprint) return [];
  const host = await scriptHost();
  const issues: Issue[] = [];
  for (const run of scriptRuns(v.blueprint)) {
    const script = run.script;
    if (typeof script.source !== 'string') continue;
    const name = `${run.label}script '${script.id}'${script.file !== undefined ? ` (${script.file})` : ''}`;
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
    issues.push(...scriptNameIssues(run, registry));
  }
  return issues;
}
