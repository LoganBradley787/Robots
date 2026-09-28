import { isFace } from './faces';
import { GUN_OUTPUTS } from '../weapons/shells';
import { keyProblem } from '../control/keys';
import { cupFootprint, defaultSize } from './footprint';
import type { ChannelDef, ColliderSpec, Face, FootprintCell, JointSpec, PartDef, SpriteSpec } from './types';

export class PartDefError extends Error {}

type Obj = Record<string, unknown>;

/** Small strict reader: every error names the file and the field path. Unknown keys are errors. */
class Reader {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  fail(path: string, msg: string): never {
    throw new PartDefError(`${this.file}: ${path} ${msg}`);
  }

  obj(v: unknown, path: string, allowed: readonly string[]): Obj {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) this.fail(path || 'def', 'must be an object');
    const o = v as Obj;
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.fail(path ? `${path}.${k}` : k, `is not a known field (expected one of: ${allowed.join(', ')})`);
    }
    return o;
  }

  req(o: Obj, key: string, path: string): unknown {
    const v = o[key];
    if (v === undefined) this.fail(join(path, key), 'is required');
    return v;
  }

  str(o: Obj, key: string, path: string): string {
    const v = this.req(o, key, path);
    if (typeof v !== 'string' || v === '') this.fail(join(path, key), 'must be a non-empty string');
    return v;
  }

  num(o: Obj, key: string, path: string): number {
    const v = this.req(o, key, path);
    if (typeof v !== 'number' || !Number.isFinite(v)) this.fail(join(path, key), 'must be a finite number');
    return v;
  }

  positive(o: Obj, key: string, path: string): number {
    const v = this.num(o, key, path);
    if (v <= 0) this.fail(join(path, key), 'must be greater than 0');
    return v;
  }

  arr(o: Obj, key: string, path: string): unknown[] {
    const v = this.req(o, key, path);
    if (!Array.isArray(v)) this.fail(join(path, key), 'must be an array');
    return v;
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

const DEF_KEYS = [
  'id', 'name', 'footprint', 'mass', 'health', 'symmetry', 'inputs', 'outputs', 'powerDraw', 'role', 'behavior', 'shellDamage',
  'behaviorConfig', 'acts', 'autoControl', 'joint', 'collider', 'resource', 'onDestroyed', 'impact', 'arming', 'sensor', 'radio', 'decoy', 'jammer', 'gun', 'solar', 'mine', 'fabricate', 'stretch', 'sprite', 'defaultTags',
] as const;

function faces(r: Reader, v: unknown, path: string): Face[] {
  if (!Array.isArray(v)) r.fail(path, 'must be an array');
  const out: Face[] = [];
  v.forEach((f, i) => {
    if (!isFace(f)) r.fail(`${path}[${i}]`, 'must be one of N, E, S, W');
    if (out.includes(f)) r.fail(`${path}[${i}]`, `repeats face ${f}`);
    out.push(f);
  });
  return out;
}

function channels(r: Reader, o: Obj, key: string): ChannelDef[] {
  return r.arr(o, key, '').map((c, i) => {
    const path = `${key}[${i}]`;
    const co = r.obj(c, path, ['name', 'min', 'max', 'default']);
    const ch = { name: r.str(co, 'name', path), min: r.num(co, 'min', path), max: r.num(co, 'max', path), default: r.num(co, 'default', path) };
    if (ch.min > ch.max) r.fail(`${path}.min`, 'must not exceed max');
    if (ch.default < ch.min || ch.default > ch.max) r.fail(`${path}.default`, 'must be between min and max');
    return ch;
  });
}

export function parsePartDef(raw: unknown, file: string): PartDef {
  const r: Reader = new Reader(file);
  const o = r.obj(raw, '', DEF_KEYS);

  const footprint: FootprintCell[] = r.arr(o, 'footprint', '').map((c, i) => {
    const path = `footprint[${i}]`;
    const co = r.obj(c, path, ['x', 'y', 'faces', 'grips']);
    const x = r.num(co, 'x', path);
    const y = r.num(co, 'y', path);
    if (!Number.isInteger(x) || !Number.isInteger(y)) r.fail(path, 'x and y must be integers');
    const cell: FootprintCell = { x, y, faces: faces(r, r.req(co, 'faces', path), `${path}.faces`) };
    if (co.grips !== undefined) {
      cell.grips = faces(r, co.grips, `${path}.grips`);
      if (cell.grips.some((f) => cell.faces.includes(f))) r.fail(`${path}.grips`, 'a face is either a face or a grip, not both');
    }
    return cell;
  });
  const seen = new Set<string>();
  for (const c of footprint) {
    if (seen.has(`${c.x},${c.y}`)) r.fail('footprint', `cell (${c.x}, ${c.y}) is listed twice`);
    seen.add(`${c.x},${c.y}`);
  }
  if (footprint.length === 0) r.fail('footprint', 'must have at least one cell');
  if (footprint[0]?.x !== 0 || footprint[0]?.y !== 0) r.fail('footprint[0]', 'must be the origin cell (0, 0)');

  const symmetry = r.num(o, 'symmetry', '');
  if (symmetry !== 1 && symmetry !== 2 && symmetry !== 4) r.fail('symmetry', 'must be 1, 2, or 4');

  const def: PartDef = {
    id: r.str(o, 'id', ''),
    name: r.str(o, 'name', ''),
    footprint,
    mass: r.positive(o, 'mass', ''),
    health: r.positive(o, 'health', ''),
    symmetry,
    inputs: channels(r, o, 'inputs'),
    outputs: channels(r, o, 'outputs'),
    powerDraw: r.num(o, 'powerDraw', ''),
    sprite: sprite(r, r.req(o, 'sprite', '')),
  };
  if (def.powerDraw < 0) r.fail('powerDraw', 'must not be negative');

  if (o.role !== undefined) {
    if (o.role !== 'core') r.fail('role', 'must be "core" when present');
    def.role = 'core';
  }
  if (o.behavior !== undefined) def.behavior = r.str(o, 'behavior', '');
  if (o.behaviorConfig !== undefined) {
    const raw = o.behaviorConfig;
    const bc = r.obj(raw, 'behaviorConfig', typeof raw === 'object' && raw !== null ? Object.keys(raw) : []);
    const cfg: Record<string, number> = {};
    for (const k of Object.keys(bc)) cfg[k] = r.num(bc, k, 'behaviorConfig');
    def.behaviorConfig = cfg;
  }
  if (o.acts !== undefined) {
    if (!isFace(o.acts)) r.fail('acts', 'must be one of N, E, S, W');
    def.acts = o.acts;
  }
  if (o.autoControl !== undefined) {
    const ao = r.obj(o.autoControl, 'autoControl', ['channel', 'kind', 'keys', 'labels']);
    const channel = r.str(ao, 'channel', 'autoControl');
    if (!def.inputs.some((c) => c.name === channel)) r.fail('autoControl.channel', `'${channel}' is not one of this part's inputs`);
    if (ao.kind !== 'axis' && ao.kind !== 'push') r.fail('autoControl.kind', 'must be "axis" or "push"');
    if (ao.kind === 'push' && def.acts === undefined) r.fail('autoControl.kind', '"push" needs "acts" (the direction the part pushes)');
    def.autoControl = { channel, kind: ao.kind };
    for (const key of ['keys', 'labels'] as const) {
      const v = ao[key];
      if (v === undefined) continue;
      if (ao.kind !== 'axis') r.fail(`autoControl.${key}`, 'is only for "axis" parts');
      if (!Array.isArray(v) || v.length !== 2 || !v.every((s) => typeof s === 'string' && s !== '')) r.fail(`autoControl.${key}`, 'must be two non-empty strings, positive then negative');
      def.autoControl[key] = [v[0] as string, v[1] as string];
    }
    const badKey = def.autoControl.keys?.map(keyProblem).find((p) => p !== undefined);
    if (badKey) r.fail('autoControl.keys', badKey);
  }
  if (o.joint !== undefined) def.joint = joint(r, o.joint, footprint);
  if (o.collider !== undefined) def.collider = collider(r, o.collider);
  if (o.resource !== undefined) {
    const ro = r.obj(o.resource, 'resource', ['kind', 'capacity']);
    def.resource = { kind: r.str(ro, 'kind', 'resource'), capacity: r.positive(ro, 'capacity', 'resource') };
  }
  if (o.onDestroyed !== undefined) {
    const od = r.obj(o.onDestroyed, 'onDestroyed', ['explode']);
    if (od.explode !== undefined) {
      const eo = r.obj(od.explode, 'onDestroyed.explode', ['radius', 'damage', 'pushRadius', 'push', 'lift']);
      const p = 'onDestroyed.explode';
      const lift = eo.lift === undefined ? 0 : r.num(eo, 'lift', p);
      if (lift < 0) r.fail(`${p}.lift`, 'must not be negative');
      def.onDestroyed = {
        explode: { radius: r.positive(eo, 'radius', p), damage: r.positive(eo, 'damage', p), pushRadius: r.positive(eo, 'pushRadius', p), push: r.positive(eo, 'push', p), lift },
      };
    } else {
      def.onDestroyed = {};
    }
  }
  if (o.shellDamage !== undefined) {
    const f = r.num(o, 'shellDamage', '');
    if (f < 0 || f > 10) r.fail('shellDamage', 'must be 0 to 10 (the share of a shell\'s damage the part takes)');
    def.shellDamage = f;
  }
  if (o.impact !== undefined) {
    const io = r.obj(o.impact, 'impact', ['speed']);
    def.impact = { speed: r.positive(io, 'speed', 'impact') };
  }
  if (o.arming !== undefined) {
    if (o.arming !== true && o.arming !== false) r.fail('arming', 'must be true or false');
    if (o.arming === true) {
      if (!def.inputs.some((c) => c.name === 'arm')) r.fail('arming', 'a part that needs arming must have an "arm" input');
      if (!def.outputs.some((c) => c.name === 'armed')) r.fail('arming', 'a part that needs arming must have an "armed" output');
      def.arming = true;
    }
  }
  if (o.sensor !== undefined) {
    const so = r.obj(o.sensor, 'sensor', ['cone', 'range']);
    const cone = r.positive(so, 'cone', 'sensor');
    if (cone > 360) r.fail('sensor.cone', 'must be at most 360 degrees (360 sees all around)');
    if (cone < 360 && def.acts === undefined) r.fail('sensor', 'a cone narrower than 360 degrees needs "acts" (the way the part looks)');
    def.sensor = { cone, range: r.positive(so, 'range', 'sensor') };
  }
  if (o.radio !== undefined) {
    // Batch: a radio is switched on and powered like a sensor part; the world does the sharing.
    const ro = r.obj(o.radio, 'radio', ['range']);
    if (def.behavior !== 'sensor') r.fail('radio', 'a radio must use the "sensor" behavior (switched on, powered)');
    if (!def.inputs.some((c) => c.name === 'on')) r.fail('radio', 'a radio must have an "on" input');
    def.radio = { range: r.positive(ro, 'range', 'radio') };
  }
  if (o.decoy !== undefined) {
    const d = r.obj(o.decoy, 'decoy', ['burn']);
    if (!def.inputs.some((c) => c.name === 'ignite')) r.fail('decoy', 'a decoy must have an "ignite" input');
    if (!def.outputs.some((c) => c.name === 'burning')) r.fail('decoy', 'a decoy must have a "burning" output');
    def.decoy = { burn: r.positive(d, 'burn', 'decoy') };
  }
  if (o.jammer !== undefined) {
    const j = r.obj(o.jammer, 'jammer', ['radius', 'seconds']);
    if (!def.inputs.some((c) => c.name === 'ignite')) r.fail('jammer', 'a jammer must have an "ignite" input');
    if (!def.outputs.some((c) => c.name === 'jamming')) r.fail('jammer', 'a jammer must have a "jamming" output');
    def.jammer = { radius: r.positive(j, 'radius', 'jammer'), seconds: r.positive(j, 'seconds', 'jammer') };
  }
  if (o.gun !== undefined) {
    const g = r.obj(o.gun, 'gun', ['speed', 'damage', 'rate', 'life', 'recoil', 'range', 'spread']);
    if (def.acts === undefined) r.fail('gun', 'a gun needs "acts" (the way it fires)');
    if (!def.inputs.some((c) => c.name === 'fire')) r.fail('gun', 'a gun must have a "fire" input');
    for (const out of GUN_OUTPUTS) if (!def.outputs.some((c) => c.name === out)) r.fail('gun', `a gun must have a "${out}" output`);
    const recoil = r.num(g, 'recoil', 'gun');
    if (recoil < 0) r.fail('gun.recoil', 'must not be negative');
    const range = r.positive(g, 'range', 'gun');
    const spread = g.spread === undefined ? 0 : r.num(g, 'spread', 'gun');
    if (spread < 0 || spread > 45) r.fail('gun.spread', 'must be 0 to 45 degrees');
    const sight = def.outputs.find((c) => c.name === 'sight');
    if (sight && sight.max !== range) r.fail('gun', `its "sight" output's max must be its range (${range})`);
    def.gun = { speed: r.positive(g, 'speed', 'gun'), damage: r.positive(g, 'damage', 'gun'), rate: r.positive(g, 'rate', 'gun'), life: r.positive(g, 'life', 'gun'), recoil, range, spread };
  }
  if (o.solar !== undefined) {
    const so = r.obj(o.solar, 'solar', ['power']);
    if (def.acts === undefined) r.fail('solar', 'a solar panel needs "acts" (the face that catches the sun)');
    def.solar = { power: r.positive(so, 'power', 'solar') };
  }
  if (o.mine !== undefined) {
    const m = r.obj(o.mine, 'mine', ['radius']);
    if (def.arming !== true) r.fail('mine', 'a mine needs arming (an "arm" input, an "armed" output, and "arming": true)');
    if (def.onDestroyed?.explode === undefined) r.fail('mine', 'a mine needs "onDestroyed.explode" (the blast it goes off with)');
    if (!def.inputs.some((c) => c.name === 'detonate')) r.fail('mine', 'a mine must have a "detonate" input');
    def.mine = { radius: r.positive(m, 'radius', 'mine') };
  }
  if (o.stretch !== undefined) {
    const so = r.obj(o.stretch, 'stretch', ['shape', 'min', 'max', 'massPerCell']);
    if (so.shape !== 'cup') r.fail('stretch.shape', 'must be "cup" (the only stretchy shape)');
    const pair = (k: 'min' | 'max'): [number, number] => {
      const v = so[k];
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n >= 1)) r.fail(`stretch.${k}`, 'must be [width, height], whole numbers of 1 or more');
      return [v[0] as number, v[1] as number];
    };
    const min = pair('min');
    const max = pair('max');
    if (max[0] < min[0] || max[1] < min[1]) r.fail('stretch', 'max must be at least min');
    if (def.acts !== 'N') r.fail('stretch', 'a cup opens on its acts face, which must be N');
    def.stretch = { shape: 'cup', min, max, massPerCell: r.positive(so, 'massPerCell', 'stretch') };
    const size = defaultSize(def) as [number, number];
    const listed = JSON.stringify(sortCells(def.footprint));
    if (listed !== JSON.stringify(sortCells(cupFootprint(size[0], size[1])))) r.fail('stretch', `its footprint must be a cup (its default size, ${size[0]} by ${size[1]})`);
    if (size[0] < min[0] || size[1] < min[1] || size[0] > max[0] || size[1] > max[1]) r.fail('stretch', 'its default size must be within min and max');
    if (Math.abs(def.mass - def.stretch.massPerCell * def.footprint.length) > 1e-9) r.fail('stretch', `its mass must be massPerCell times its default cells (${def.stretch.massPerCell * def.footprint.length})`);
  }
  if (o.fabricate !== undefined) {
    const f = r.obj(o.fabricate, 'fabricate', ['joulesPerKg', 'secondsPerKg', 'separation']);
    if (!def.footprint.some((c) => (c.grips ?? []).length > 0)) r.fail('fabricate', 'a fabricator needs grips to hold what it builds');
    if (def.acts === undefined) r.fail('fabricate', 'a fabricator needs "acts" (the way it lets things go)');
    if (!def.inputs.some((c) => c.name === 'release')) r.fail('fabricate', 'a fabricator must have a "release" input');
    for (const out of ['ready', 'progress', 'built']) if (!def.outputs.some((c) => c.name === out)) r.fail('fabricate', `a fabricator must have a "${out}" output`);
    def.fabricate = { joulesPerKg: r.positive(f, 'joulesPerKg', 'fabricate'), secondsPerKg: r.positive(f, 'secondsPerKg', 'fabricate'), separation: r.positive(f, 'separation', 'fabricate') };
  }
  if (o.defaultTags !== undefined) {
    def.defaultTags = r.arr(o, 'defaultTags', '').map((t, i) => {
      if (typeof t !== 'string' || t === '') r.fail(`defaultTags[${i}]`, 'must be a non-empty string');
      return t;
    });
  }
  return def;
}

function sprite(r: Reader, v: unknown): SpriteSpec {
  const so = r.obj(v, 'sprite', ['frame', 'mountFrame', 'animation', 'overlay', 'armedFrame', 'litFrame', 'tiles']);
  const s: SpriteSpec = { frame: r.str(so, 'frame', 'sprite') };
  if (so.mountFrame !== undefined) s.mountFrame = r.str(so, 'mountFrame', 'sprite');
  if (so.animation !== undefined) s.animation = r.str(so, 'animation', 'sprite');
  if (so.overlay !== undefined) s.overlay = r.str(so, 'overlay', 'sprite');
  if (so.armedFrame !== undefined) s.armedFrame = r.str(so, 'armedFrame', 'sprite');
  if (so.litFrame !== undefined) s.litFrame = r.str(so, 'litFrame', 'sprite');
  if (so.tiles !== undefined) {
    const t = r.obj(so.tiles, 'sprite.tiles', ['floor', 'corner', 'wall', 'mouth', 'back']);
    s.tiles = { floor: r.str(t, 'floor', 'sprite.tiles'), corner: r.str(t, 'corner', 'sprite.tiles'), wall: r.str(t, 'wall', 'sprite.tiles'), mouth: r.str(t, 'mouth', 'sprite.tiles'), back: r.str(t, 'back', 'sprite.tiles') };
  }
  return s;
}

function joint(r: Reader, v: unknown, footprint: FootprintCell[]): JointSpec {
  const jo = r.obj(v, 'joint', ['kind', 'mountFace', 'motor', 'maxTorque', 'motorFactor']);
  if (jo.kind !== 'revolute') r.fail('joint.kind', 'must be "revolute"');
  if (!isFace(jo.mountFace)) r.fail('joint.mountFace', 'must be one of N, E, S, W');
  if (jo.motor !== 'velocity' && jo.motor !== 'position') r.fail('joint.motor', 'must be "velocity" or "position"');
  if (footprint.length !== 1) r.fail('joint', 'is only supported on one-cell parts');
  const faces = footprint[0]?.faces ?? [];
  if (!faces.includes(jo.mountFace)) r.fail('joint.mountFace', `${jo.mountFace} is not an attachable face`);
  // A wheel is a ball: anything welded to its other faces would spin with it. Position joints carry parts.
  if (jo.motor === 'velocity' && faces.length !== 1) r.fail('footprint[0].faces', `must be exactly [${jo.mountFace}]: a velocity joint part attaches only through its mount face`);
  if (jo.motor === 'position' && jo.motorFactor !== undefined) r.fail('joint.motorFactor', 'is for velocity motors; a position motor gets its gains from its behavior');
  return {
    kind: 'revolute',
    mountFace: jo.mountFace,
    motor: jo.motor,
    maxTorque: r.positive(jo, 'maxTorque', 'joint'),
    motorFactor: jo.motor === 'velocity' ? r.positive(jo, 'motorFactor', 'joint') : 0,
  };
}

function collider(r: Reader, v: unknown): ColliderSpec {
  const co = r.obj(v, 'collider', ['shape', 'radius', 'friction']);
  if (co.shape !== 'box' && co.shape !== 'ball') r.fail('collider.shape', 'must be "box" or "ball"');
  const c: ColliderSpec = { shape: co.shape };
  if (co.shape === 'ball') {
    const radius = r.positive(co, 'radius', 'collider');
    if (radius > 0.5) r.fail('collider.radius', 'must be at most 0.5 so the ball fits its cell');
    c.radius = radius;
  }
  if (co.friction !== undefined) {
    const f = r.num(co, 'friction', 'collider');
    if (f < 0) r.fail('collider.friction', 'must not be negative');
    c.friction = f;
  }
  return c;
}

/** Cells in a fixed order with sorted faces, to compare footprints. */
function sortCells(cells: readonly FootprintCell[]): unknown[] {
  return [...cells]
    .map((c) => ({ x: c.x, y: c.y, faces: [...c.faces].sort(), grips: [...(c.grips ?? [])].sort() }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
