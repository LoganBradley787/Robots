import type { PartDef } from './types';
import { parsePartDef } from './parsePartDef';
import core from './defs/core.json';
import frame from './defs/frame.json';
import battery from './defs/battery.json';
import wheel from './defs/wheel.json';
import thruster from './defs/thruster.json';
import propeller from './defs/propeller.json';
import decoupler from './defs/decoupler.json';
import warhead from './defs/warhead.json';

export class PartRegistry {
  private readonly defs = new Map<string, PartDef>();

  constructor(defs: readonly PartDef[]) {
    for (const d of defs) {
      if (this.defs.has(d.id)) throw new Error(`duplicate part id "${d.id}"`);
      this.defs.set(d.id, d);
    }
  }

  get(id: string): PartDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`unknown part "${id}" (known: ${this.ids().join(', ')})`);
    return d;
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  /** Defs in registration order. */
  list(): PartDef[] {
    return [...this.defs.values()];
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }
}

const SHIPPED: Array<[string, unknown]> = [
  ['core.json', core],
  ['frame.json', frame],
  ['battery.json', battery],
  ['wheel.json', wheel],
  ['thruster.json', thruster],
  ['propeller.json', propeller],
  ['decoupler.json', decoupler],
  ['warhead.json', warhead],
];

let shipped: PartRegistry | null = null;

/** The eight starting parts, parsed once. */
export function defaultRegistry(): PartRegistry {
  if (!shipped) shipped = new PartRegistry(SHIPPED.map(([file, raw]) => parsePartDef(raw, `parts/defs/${file}`)));
  return shipped;
}
