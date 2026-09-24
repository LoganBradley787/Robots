import { dropForeignScriptFiles, allScripts, assignScriptFiles, defaultRegistry, expandBlueprint, formatIssues, mirrorBlueprint, scriptFiles, toFileJson, validateBlueprint } from '@robots/sim-core';

export interface MirrorArgs {
  /** The mirror axis in half cells (x maps to axis - x). Default: the middle of the robot, so it stays in place. */
  axis?: number;
  saveAs?: string;
}

export interface MirrorOutput {
  ok: boolean;
  /** For stdout: the blueprint's json (scripts inline), or when saving, what was saved. Empty when it failed. */
  text: string;
  /** For stderr: notes, warnings, and validator issues, so stdout stays pure json. */
  notes: string[];
  /** Files to write when saving, relative to blueprints/. */
  files: { file: string; text: string }[];
}

/** `pnpm sim mirror <bp>`: the blueprint flipped left to right (`02` helper), printed or saved under a new name. */
export function mirrorCommand(raw: unknown, args: MirrorArgs): MirrorOutput {
  const registry = defaultRegistry();
  const e = expandBlueprint(raw);
  if (!e.blueprint) return { ok: false, text: '', notes: [formatIssues(e.issues)], files: [] };
  const src = e.blueprint;
  const xs = src.parts.map((p) => p.x);
  const axis = args.axis ?? (xs.length > 0 ? Math.min(...xs) + Math.max(...xs) : 0);
  let bp = mirrorBlueprint(src, axis);
  const notes: string[] = [];
  if (allScripts(bp).length > 0) notes.push('note: scripts are copied unchanged; one that steers left or right (signs of x, spin, or angle) may need flipping');
  const v = validateBlueprint(toFileJson(bp, registry, { inlineScripts: true }), registry);
  if (v.issues.length > 0) notes.push(formatIssues(v.issues));
  if (args.saveAs === undefined) return { ok: v.ok, text: JSON.stringify(toFileJson(dropForeignScriptFiles(bp), registry, { inlineScripts: true }), null, 2), notes, files: [] };
  const file = `${args.saveAs}.json`;
  bp = assignScriptFiles({ ...bp, name: args.saveAs }, file, false);
  const files = [{ file, text: `${JSON.stringify(toFileJson(bp, registry), null, 2)}\n` }, ...scriptFiles(bp)];
  return { ok: v.ok, text: `saved ${files.map((f) => f.file).join(', ')}`, notes, files };
}
