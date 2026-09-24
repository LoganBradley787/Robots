import { assignScriptFiles, defaultRegistry, expandBlueprint, formatIssues, placeBlueprint, scriptFiles, toFileJson, validateBlueprint, type Rotation } from '@robots/sim-core';

export interface PlaceArgs {
  at: { x: number; y: number };
  rot?: Rotation;
  mirror?: boolean;
  /** Save as this blueprint name: the file json plus its script files, named after it. */
  saveAs?: string;
}

export interface PlaceOutput {
  ok: boolean;
  /** What to print: the placed blueprint's json (scripts inline) or, when saving, a summary; then any issues. */
  text: string;
  /** Files to write when saving: `<name>.json` and its scripts, relative to blueprints/. */
  files: { file: string; text: string }[];
}

/**
 * `pnpm sim place <target> <source> --at x,y`: a copy of `source` placed on `target` (M7), the same as the builder's
 * Blueprints palette. Both come in with their scripts loaded.
 */
export function placeCommand(targetRaw: unknown, sourceRaw: unknown, args: PlaceArgs): PlaceOutput {
  const registry = defaultRegistry();
  const target = expandBlueprint(targetRaw);
  if (!target.blueprint) return { ok: false, text: `target: ${formatIssues(target.issues)}`, files: [] };
  const source = expandBlueprint(sourceRaw);
  if (!source.blueprint) return { ok: false, text: `source: ${formatIssues(source.issues)}`, files: [] };
  const r = placeBlueprint(target.blueprint, source.blueprint, args.at, registry, { ...(args.rot !== undefined ? { rot: args.rot } : {}), ...(args.mirror ? { mirror: true } : {}) });
  if (!r.ok) return { ok: false, text: `cannot place: ${r.error}`, files: [] };
  let bp = r.blueprint;
  const notes = r.warnings.map((w) => `warning: ${w}`);
  if (r.scope !== undefined) notes.push(`placed ${source.blueprint.name} as ${r.scope}: its parts are tagged ${r.scope}, its own tags became ${r.scope}.<tag>`);
  const v = validateBlueprint(toFileJson(bp, registry, { inlineScripts: true }), registry);
  if (v.issues.length > 0) notes.push(formatIssues(v.issues));
  if (args.saveAs === undefined) {
    return { ok: v.ok, text: [JSON.stringify(toFileJson(bp, registry, { inlineScripts: true }), null, 2), ...notes].join('\n'), files: [] };
  }
  const file = `${args.saveAs}.json`;
  // Like Save As: every script gets a file named after the new blueprint, so the originals are never touched.
  bp = assignScriptFiles({ ...bp, name: args.saveAs }, file, false);
  const files = [{ file, text: `${JSON.stringify(toFileJson(bp, registry), null, 2)}\n` }, ...scriptFiles(bp)];
  return { ok: v.ok, text: [`saved ${files.map((f) => f.file).join(', ')}`, ...notes].join('\n'), files };
}
