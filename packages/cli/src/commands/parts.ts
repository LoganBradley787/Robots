import { DEFAULT_LEGEND, hollowCells, type PartDef, type PartRegistry } from '@robots/sim-core';

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

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ';', "'", '/'];

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
  const once = d.arming ? ' once armed' : '';
  if (d.arming) out.push('needs arming: safe until its arm input goes above 0.5 (a key or a script), then armed for good; unarmed it breaks without a blast, ignores hard hits and detonate; "armed": true in a blueprint starts it armed');
  if (boom) out.push(`explodes when destroyed${once}: ${boom.damage} damage at the center falling to 0 at ${boom.radius} m (halved by each part or box in the way), push ${boom.push} N s per cell out to ${boom.pushRadius} m`);
  if (d.sensor) {
    const cone = d.sensor.cone >= 360 ? 'all around' : `in a ${d.sensor.cone} degree cone toward its ${d.acts ?? 'N'} face`;
    out.push(`sensor: sees robots ${cone} out to ${d.sensor.range} m (terrain blocks it, robots do not); scripts read them in contacts and scan(id); on 0 switches it off`);
  }
  if (d.stretch) out.push(`stretches: "size": [w, h] on the placed part sets its hollow, ${d.stretch.min[0]} to ${d.stretch.max[0]} wide and ${d.stretch.min[1]} to ${d.stretch.max[1]} tall; ${d.stretch.massPerCell} kg per cell (the mass above is its default size)`);
  if (d.fabricate) {
    const hollow = hollowCells(d);
    const w = Math.max(...hollow.map((c) => c.x)) - Math.min(...hollow.map((c) => c.x)) + 1;
    const h = Math.max(...hollow.map((c) => c.y)) - Math.min(...hollow.map((c) => c.y)) + 1;
    out.push(`fabricator: builds its recipe (the part's "makes") in its hollow (${w} by ${h} by default): ${d.fabricate.joulesPerKg} J per kg plus what its containers hold, ${d.fabricate.secondsPerKg} s per kg (longer if its draw of ${d.powerDraw} J/s cannot pay for that); starts the next as soon as its hollow is clear; release lets the finished one go (pushed out ${d.fabricate.separation} N s along its ${d.acts ?? 'N'} face); outputs ready, progress (0 to 1), built`);
  }
  if (d.decoy) out.push(`decoy: lit for good once its ignite input goes above 0.5 (a key or a script), it burns ${d.decoy.burn} s and is gone; while it burns, every sensor that sees it takes it for the robot it was part of when lit (contacts and scan report that robot at the flare); burning reads 1`);
  if (d.gun) {
    const g = d.gun;
    out.push(`gun: while fire is above 0.5, ${g.rate} shells a second out of its ${d.acts ?? 'N'} face at ${g.speed} m/s; a shell falls under gravity, takes ${g.damage} off the first part it hits (anyone's, friends and its own robot too) and is gone after ${g.life} s; ${g.recoil} N s of kick per shot; no energy`);
    out.push(`gun sight: looks ${g.range} m straight out of the barrel: sight (meters to the first thing, ${g.range} for nothing), sightSide (0 nothing, 1 own robot, 2 friend, 3 enemy, 4 nobody's, 5 terrain), sightId (the robot's contact id), aim (the barrel's world angle, radians)`);
  }
  if (d.impact) out.push(`${d.arming ? 'once armed, ' : ''}breaks when a hit stops it by more than ${d.impact.speed} m/s (a fall of about ${((d.impact.speed * d.impact.speed) / (2 * G)).toFixed(1)} m)`);
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
