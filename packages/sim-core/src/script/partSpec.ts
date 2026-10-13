import type { Face, PartDef } from '../parts/types';
import type { PartRegistry } from '../parts/registry';
import { faceDir } from '../parts/faces';

/**
 * A part's static numbers, as a script reads them off `part.spec` (M16): what its definition says it can do, so a
 * script can add up its engines (`p.spec.config.maxForce`) and scale an input by its range instead of hardcoding
 * "lift 120 per propeller". Read off the definition by one rule for every part, never per part type:
 * - `in`: each input's `min`, `max`, and `default`, by name, in the definition's order;
 * - `config`: the numbers of the definition's `behaviorConfig` (a thruster's `maxForce`, a gyro's `maxTorque`, a
 *   rotator's `range` and `turnSpeed`); empty for a part without one;
 * - `powerDraw` (J/s at full use) and `maxHealth`;
 * - `acts`, for a part that acts along one of its faces (it pushes, fires, or looks that way): that way when the part
 *   is built unturned, in degrees counterclockwise from its body's x axis (90: up the grid). With the part's own `rot`
 *   and `angle`, the way it acts in the world is `angle + (rot + spec.acts) * Math.PI / 180`. With it comes `tip`,
 *   where the end it acts from is (a barrel's end), from the part's position when built unturned: `{ x, y }` in meters;
 * - then every other block of the definition that holds numbers, under its own name, with only its numbers
 *   (`gun.speed`, `sensor.range`, `resource.capacity`, `joint.maxTorque`). Text, lists, and blocks inside blocks are
 *   left out.
 * The same for every part of a type, so it is sent with the layout, once per type (`frame.ts`), never per tick.
 */
export interface ScriptPartSpec {
  in: Record<string, { min: number; max: number; default: number }>;
  config: Record<string, number>;
  powerDraw: number;
  maxHealth: number;
  /** The way the part acts when built unturned, in degrees counterclockwise from its body's x axis. Absent when it acts along no face. */
  acts?: number;
  /**
   * With `acts`: where the end it acts from is (a barrel's end), from the part's own position, built unturned, in
   * meters. In the world that is `pos` plus this turned by `angle + rot` degrees.
   */
  tip?: { x: number; y: number };
  /** Any other block of the definition that holds numbers (`gun`, `sensor`, `joint`, ...): an object of numbers. */
  [block: string]: unknown;
}

/** The names `partSpec` writes itself: a definition's block of the same name is left out. */
const OWN = ['in', 'config', 'powerDraw', 'maxHealth', 'acts', 'tip'];

/** A face as degrees counterclockwise from the x axis. */
const FACE_DEGREES: Readonly<Record<Face, number>> = { E: 0, N: 90, W: 180, S: 270 };

function numbers(o: object): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** A part definition's static numbers for scripts (`ScriptPartSpec`). */
export function partSpec(def: PartDef): ScriptPartSpec {
  const inputs: ScriptPartSpec['in'] = {};
  for (const c of def.inputs) inputs[c.name] = { min: c.min, max: c.max, default: c.default };
  const spec: ScriptPartSpec = { in: inputs, config: numbers(def.behaviorConfig ?? {}), powerDraw: def.powerDraw, maxHealth: def.health };
  if (def.acts !== undefined) {
    spec.acts = FACE_DEGREES[def.acts];
    // The end it acts from, as the world places a barrel's end: half a cell out of the middle of the cells farthest
    // along `acts` (one cell for most parts; a part two cells wide at that end acts from between them).
    const f = faceDir(def.acts);
    let best = -Infinity;
    let x = 0;
    let y = 0;
    let tied = 0;
    for (const c of def.footprint) {
      const along = c.x * f.x + c.y * f.y;
      if (along > best) {
        best = along;
        x = c.x;
        y = c.y;
        tied = 1;
      } else if (along === best) {
        x += c.x;
        y += c.y;
        tied++;
      }
    }
    spec.tip = { x: x / Math.max(1, tied) + 0.5 * f.x, y: y / Math.max(1, tied) + 0.5 * f.y };
  }
  for (const [key, value] of Object.entries(def)) {
    if (key === 'behaviorConfig' || OWN.includes(key) || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const block = numbers(value);
    if (Object.keys(block).length > 0) spec[key] = block;
  }
  return spec;
}

/**
 * Every part type's spec as one JSON text, `{ "<type>": spec, ... }` in registry order: what a script host is handed
 * with a layout (`ScriptLayout.specs`). One text per registry, so a host that has sent it once never sends it again.
 */
export function partSpecsJson(registry: PartRegistry): string {
  let text = '{';
  for (const def of registry.list()) text += `${text.length > 1 ? ',' : ''}${JSON.stringify(def.id)}:${JSON.stringify(partSpec(def))}`;
  return `${text}}`;
}
