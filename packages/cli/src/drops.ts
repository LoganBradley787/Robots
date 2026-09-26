import { defaultRegistry, orientRaw } from '@robots/sim-core';
import { readBlueprint, resolveBlueprint } from './blueprintFiles';
import type { Drop } from './commands/run';
import { parseSpawnSuffixes } from './spawnSpec';

/** `bomb@2:3,6`: blueprint bomb at 2 s, root at (3, 6); `enemy-drone@0:80,20:enemy:flip` also sets its team and facing (M8). */
export function parseDrop(raw: string): Drop {
  const num = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const m = new RegExp(`^([^@]+)@(${num}):(${num}),(${num})((?::[A-Za-z0-9]+)*)$`).exec(raw.trim());
  if (!m) throw new Error(`--drop must look like bomb@2:3,6 (blueprint@seconds:x,y), with optional :enemy, :flip, :rot90 after it; got ${raw}`);
  const [, name = '', t = '0', x = '0', y = '0', rest = ''] = m;
  const spec = parseSpawnSuffixes(rest.split(':').filter((s) => s !== ''), `--drop ${name}`);
  const loaded = readBlueprint(resolveBlueprint(name));
  for (const f of loaded.missing) console.error(`warning: script file ${f} not found next to ${name}`);
  return { name, blueprint: orientRaw(loaded.raw, spec, defaultRegistry()), t: Number(t), at: { x: Number(x), y: Number(y) }, ...(spec.team !== 0 ? { team: spec.team } : {}) };
}
