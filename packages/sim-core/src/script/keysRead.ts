/**
 * Keys a script reads with `keys.down('w')` and friends (M7), found in its source, so the keys bar can show them and
 * the headless runner does not call them unused. `any` when a script reads a key that is not a plain string (it could
 * be any key).
 */
export function keysScriptsRead(sources: readonly string[]): { keys: Set<string>; any: boolean } {
  const keys = new Set<string>();
  let any = false;
  for (const src of sources) {
    for (const m of src.matchAll(/keys\s*\.\s*(?:down|pressed|released)\s*\(\s*(?:(['"])([^'"]*)\1\s*\)|)/g)) {
      if (m[2] !== undefined) keys.add(m[2]);
      else any = true;
    }
  }
  return { keys, any };
}
