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
  swivel: 'deg',
  area: 'm2',
  deflect: 'degrees',
  maxTorque: 'N m',
  dampTorque: 'N m',
  coastTorque: 'N m',
  dampTime: 's',
  maxSpeed: 'rad/s',
  turnSpeed: 'rad/s',
  range: 'rad',
  frequency: 'Hz',
  stroke: 'm',
  extendSpeed: 'm/s',
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
  if (d.joint?.kind === 'prismatic') out.push(`sliding joint mounted by its ${d.joint.mountFace} face at rotation 0: the part slides out of its cell the other way, carrying what is on its other faces, up to ${d.joint.maxForce} N`);
  else if (d.joint) out.push(`${d.joint.motor} motor joint mounted by its ${d.joint.mountFace} face, up to ${d.joint.maxTorque} N m`);
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
  if ((d.behaviorConfig?.swivel ?? 0) > 0 && d.inputs.some((c) => c.name === 'swivel')) {
    out.push(`swivels: the swivel input (-1 to 1) tilts its push up to ${d.behaviorConfig?.swivel} degrees counterclockwise (positive) or clockwise (negative) from its ${d.acts ?? 'N'} face; the push lands at its cell, so a tilt also turns the robot; no auto key for swivel: bind one or use a script`);
  }
  if (d.behavior === 'fin' && d.behaviorConfig) {
    const area = d.behaviorConfig.area ?? 0;
    out.push(`fin: a flat plate along its ${d.acts ?? 'N'} axis that pushes on the air: at speed it takes 0.5 * 1.2 * ${area} * (speed across the plate) * speed N, against the way it moves, at its cell (${(0.6 * area).toFixed(2)} N per (m/s)^2 straight across; nothing along the plate); deflect (-1 to 1) turns the plate up to ${d.behaviorConfig.deflect ?? 0} degrees counterclockwise to steer; fins behind the middle keep the nose into the wind; no energy`);
  }
  const boom = d.onDestroyed?.explode;
  const once = d.arming ? ' once armed' : '';
  if (d.arming) out.push('needs arming: safe until its arm input goes above 0.5 (a key or a script), then armed for good; unarmed it breaks without a blast, ignores hard hits and detonate; "armed": true in a blueprint starts it armed');
  if (boom) out.push(`explodes when destroyed${once}: ${boom.damage} damage at the center falling to 0 at ${boom.radius} m (halved by each part or box in the way), push ${boom.push} N s per cell out to ${boom.pushRadius} m`);
  if (d.sensor) {
    const cone = d.sensor.cone >= 360 ? 'all around' : `in a ${d.sensor.cone} degree cone toward its ${d.acts ?? 'N'} face`;
    out.push(`sensor: sees robots ${cone} out to ${d.sensor.range} m (terrain blocks it, robots do not); scripts read them in contacts and scan(id); on 0 switches it off`);
  }
  if (d.radio) out.push(`radio: shares what its robot's own sensors see with every robot of its team that has a working radio within ${d.radio.range} m (no relaying); shared robots join contacts with by "radio" (scan(id) still needs your own sensors); on 0 switches it off`);
  if (d.stretch) out.push(`stretches: "size": [w, h] on the placed part sets its hollow, ${d.stretch.min[0]} to ${d.stretch.max[0]} wide and ${d.stretch.min[1]} to ${d.stretch.max[1]} tall; ${d.stretch.massPerCell} kg per cell (the mass above is its default size)`);
  if (d.fabricate) {
    const hollow = hollowCells(d);
    const w = Math.max(...hollow.map((c) => c.x)) - Math.min(...hollow.map((c) => c.x)) + 1;
    const h = Math.max(...hollow.map((c) => c.y)) - Math.min(...hollow.map((c) => c.y)) + 1;
    out.push(`fabricator: builds its recipe (the part's "makes") in its hollow (${w} by ${h} by default): ${d.fabricate.joulesPerKg} J per kg plus what its containers hold, ${d.fabricate.secondsPerKg} s per kg for parts with no build time of their own (a recipe takes the sum over its parts; longer if its draw of ${d.powerDraw} J/s cannot pay for that); starts the next as soon as its hollow is clear; release lets the finished one go (pushed out ${d.fabricate.separation} N s along its ${d.acts ?? 'N'} face); outputs ready, progress (0 to 1), built`);
  }
  if (d.build !== undefined) out.push(`build time: ${d.build} s in a fabricator (a part without one takes the bay's seconds per kg times its mass)`);
  if (d.decoy) out.push(`decoy: lit for good once its ignite input goes above 0.5 (a key or a script), it burns ${d.decoy.burn} s and is gone; while it burns, every sensor that sees it takes it for the robot it was part of when lit (contacts and scan report that robot at the flare); burning reads 1`);
  if (d.jammer) out.push(`jammer: lit for good once its ignite input goes above 0.5 (a key or a script), attached or let go; it jams for ${d.jammer.seconds} s and is then spent and gone; while it jams, within ${d.jammer.radius} m of the pod a sensor sees nothing, and a sensor anywhere else sees no robot whose reference point (its core, else its center) is in the bubble; gun sights are not sensors; jamming reads 1`);
  if (d.smoke) out.push(`smoke pod: once its on input goes above 0.5 (a key or a script) it releases a cloud ${d.smoke.radius} m in radius where it is and is used up (gone without a blast); the cloud stays put (sinking 0.5 m/s) for ${d.smoke.seconds} s; while it lasts, sensors cannot see through it (contacts and scan): a robot is not seen when the line from the sensor touches the cloud, and a sensor or robot inside it is blind or hidden; shells and gun sights pass through`);
  if (d.gun) {
    const g = d.gun;
    out.push(`gun: while fire is above 0.5, ${g.rate} shells a second out of its ${d.acts ?? 'N'} face at ${g.speed} m/s; a shell falls under gravity, takes ${g.damage} off the first part it hits (anyone's, friends and its own robot too) and is gone after ${g.life} s; each leaves up to ${g.spread} degrees off the barrel's line (center weighted, the same every replay); ${g.recoil} N s of kick per shot; no energy`);
    out.push(`gun sight: looks ${g.range} m straight out of the barrel: sight (meters to the first thing, ${g.range} for nothing), sightSide (0 nothing, 1 own robot, 2 friend, 3 enemy, 4 nobody's, 5 terrain), sightId (the robot's contact id), aim (the barrel's world angle, radians)`);
  }
  if (d.shellDamage !== undefined) out.push(`armor: takes ${d.shellDamage} of a shell's damage (${Math.ceil(d.health / (5 * d.shellDamage))} hits from a 5 damage shell); blasts hurt it in full`);
  if (d.solar) out.push(`solar: adds ${d.solar.power} J/s (times the cosine of the angle between its ${d.acts ?? 'N'} face and straight up, nothing when level or down) to its chunk's energy pool while its ${d.acts ?? 'N'} face points up; it fills batteries, cells, and cores up to their capacity; no inputs or outputs`);
  if (d.mine) out.push(`proximity mine: once armed it goes off (the blast above, then it is gone) when any part of a robot of another team comes within ${d.mine.radius} m (a flare counts as the robot it stands in for; friends and wrecks do not set it off), or on a detonate pulse; destroyed any other way (shot, caught in a blast) it breaks as a dud, without a blast; no impact fuze`);
  if (d.grapple) {
    const g = d.grapple;
    out.push(`grapple: fire rising above 0.5 (once per press) casts a hook ${g.reach} m out of its ${d.acts ?? 'N'} face and ties a rope to the first thing it hits (another robot's part, debris, a loose block, or the ground; never its own robot), ${g.minLength} to ${g.maxLength} m long, as long as the distance at the hit; a taut rope tows what is on the other end`);
    out.push(`grapple rope: reel (-1 to 1, positive pulls in) shortens it up to ${g.reelSpeed} m/s (taking up slack first), negative pays it out; release above 0.5 drops it (and wins over fire on the same tick); it is gone when either end's part is destroyed; outputs hooked (0 or 1) and length (meters, 0 with no rope); no energy`);
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
