import { DEFAULT_LEGEND, type PartDef, type PartRegistry } from '@robots/sim-core';

export interface PartRow {
  /** The builder key that picks it (1 to 9, 0, -). */
  key: string;
  id: string;
  /** Default legend tokens for it, rotation 0 first. */
  legend: string[];
  mass: number;
  health: number;
  /** Faces other parts can attach to, at rotation 0. */
  faces: string[];
  /** Energy per second at full input. */
  power: number;
  /** What it does, one line each, from its definition. */
  details: string[];
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

/** Units for behavior settings, by setting name. */
const UNITS: Record<string, string> = {
  maxForce: 'N',
  maxTorque: 'N m',
  dampTorque: 'N m',
  coastTorque: 'N m',
  dampTime: 's',
  maxSpeed: 'rad/s',
  turnSpeed: 'rad/s',
  range: 'rad',
  frequency: 'Hz',
  separation: 'N s',
};

const G = 9.81;

function details(d: PartDef): string[] {
  const out: string[] = [];
  if (d.role === 'core') out.push('a core: bindings and scripts belong to a core; the primary core pilots the robot, others wake when their piece breaks off');
  if (d.resource) out.push(`stores ${d.resource.capacity} J of ${d.resource.kind}`);
  if (d.acts) out.push(`acts toward its ${d.acts} face at rotation 0 (the legend arrow points the way it acts)`);
  const cfg = Object.entries(d.behaviorConfig ?? {});
  const unit = (k: string, v: number): string => (UNITS[k] === 'rad' ? `${v} rad (${Math.round((v * 180) / Math.PI)} deg)` : `${v}${UNITS[k] ? ` ${UNITS[k]}` : ''}`);
  if (cfg.length > 0) out.push(`${d.behavior ?? 'settings'}: ${cfg.map(([k, v]) => `${k} ${unit(k, v)}`).join(', ')}`);
  if (d.joint) out.push(`${d.joint.motor} motor joint mounted by its ${d.joint.mountFace} face, up to ${d.joint.maxTorque} N m`);
  if (d.collider) out.push(`${d.collider.shape} collider, radius ${d.collider.radius} m, friction ${d.collider.friction}`);
  if (d.inputs.length > 0) out.push(`inputs: ${d.inputs.map((c) => `${c.name} ${c.min} to ${c.max}`).join(', ')}`);
  if (d.outputs.length > 0) out.push(`outputs scripts can read: ${d.outputs.map((c) => c.name).join(', ')}`);
  if (d.autoControl) {
    const a = d.autoControl;
    if (a.kind === 'axis') {
      const [pos, neg] = (a.keys ?? ['d', 'a']).map((k) => k.toUpperCase());
      const [lp, ln] = a.labels ?? ['forward', 'reverse'];
      out.push(`auto controls: ${pos} / ${neg} set ${a.channel} to max / min (${lp} / ${ln})`);
    } else {
      out.push(`auto controls: the key for the way it pushes (W up, S down, D right, A left) sets ${a.channel} to max`);
    }
  }
  const boom = d.onDestroyed?.explode;
  if (boom) out.push(`explodes when destroyed: ${boom.damage} damage at the center falling to 0 at ${boom.radius} m (halved by each part or box in the way), push ${boom.push} N s per cell out to ${boom.pushRadius} m`);
  if (d.impact) out.push(`breaks when a hit stops it by more than ${d.impact.speed} m/s (a fall of about ${((d.impact.speed * d.impact.speed) / (2 * G)).toFixed(1)} m)`);
  return out;
}

/** Every part definition, in builder palette order (M7: so nobody reads JSON defs to design). */
export function partRows(registry: PartRegistry): PartRow[] {
  return registry.list().map((d, i) => ({
    key: KEYS[i] ?? '',
    id: d.id,
    legend: Object.entries(DEFAULT_LEGEND)
      .filter(([, e]) => e.part === d.id)
      .sort((a, b) => (a[1].rot ?? 0) - (b[1].rot ?? 0))
      .map(([t]) => t),
    mass: d.mass,
    health: d.health,
    faces: d.footprint[0]?.faces ?? [],
    power: d.powerDraw,
    details: details(d),
  }));
}

export function formatParts(rows: readonly PartRow[]): string {
  const head = ['key', 'part', 'legend', 'mass kg', 'health', 'attaches', 'power J/s'];
  const cells = rows.map((r) => [r.key, r.id, r.legend.join(' ') || '-', String(r.mass), String(r.health), r.faces.join(' '), String(r.power)]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? '').length)));
  const line = (c: readonly string[]): string => c.map((v, i) => v.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  const out = [
    'Parts, in builder palette order. One cell is 1 m. Faces are at rotation 0 (N up); rotations are counterclockwise.',
    'Legend arrows point the way a part acts (T^ pushes up, D> releases right, W sits below what it mounts to).',
    '',
    line(head),
  ];
  rows.forEach((r, i) => {
    out.push(line(cells[i] ?? []));
    for (const d of r.details) out.push(`     ${d}`);
  });
  return out.join('\n');
}
