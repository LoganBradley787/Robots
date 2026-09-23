import type { Blueprint, ScriptSpec } from '@robots/sim-core';

/** What a new script starts with: the shape of the API, and nothing that moves the robot yet. */
export const NEW_SCRIPT = `// Runs every tick while it is on. You get exact data: self.pos, self.vel, self.angle, self.angVel,
// self.energy, parts, and keys.down('a'). Write channels with set('propeller', 'throttle', 0.5).
// state persists between ticks; param('name', 1) makes a setting you can change in the builder.

function setup() {
  // runs when the script turns on
}

function tick() {
  // runs every tick (60 per second)
}
`;

/** A script id is a name you bind keys to: letters, digits, and dashes. */
export function cleanScriptId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function addScript(bp: Blueprint): { bp: Blueprint; id: string } {
  let n = 1;
  const taken = new Set(bp.scripts.map((s) => s.id));
  while (taken.has(n === 1 ? 'script' : `script${n}`)) n++;
  const id = n === 1 ? 'script' : `script${n}`;
  const spec: ScriptSpec = { id, enabled: true, params: {}, source: NEW_SCRIPT };
  return { bp: { ...bp, scripts: [...bp.scripts, spec] }, id };
}

/** Renames a script and the bindings that toggle it. Refuses empty or taken ids (returns the blueprint as is). */
export function renameScript(bp: Blueprint, from: string, to: string): Blueprint {
  const id = cleanScriptId(to);
  if (id === '' || id === from || bp.scripts.some((s) => s.id === id)) return bp;
  return {
    ...bp,
    // The file keeps its name until Save As; a renamed script without a file gets one named after the new id on Save.
    scripts: bp.scripts.map((s) => (s.id === from ? { ...s, id } : s)),
    bindings: bp.bindings.map((b) => (b.mode === 'script' && b.script === from ? { ...b, script: id } : b)),
  };
}

/** Removes a script and every binding that toggles it. */
export function removeScript(bp: Blueprint, id: string): Blueprint {
  return { ...bp, scripts: bp.scripts.filter((s) => s.id !== id), bindings: bp.bindings.filter((b) => !(b.mode === 'script' && b.script === id)) };
}

export function updateScript(bp: Blueprint, id: string, patch: Partial<Pick<ScriptSpec, 'source' | 'enabled' | 'params'>>): Blueprint {
  let changed = false;
  const scripts = bp.scripts.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...patch };
    changed = JSON.stringify(next) !== JSON.stringify(s);
    return next;
  });
  return changed ? { ...bp, scripts } : bp;
}
