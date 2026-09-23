import { isFace } from './faces';
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
  'id', 'name', 'footprint', 'mass', 'health', 'symmetry', 'inputs', 'outputs', 'powerDraw', 'behavior',
  'behaviorConfig', 'joint', 'collider', 'resource', 'onDestroyed', 'sprite', 'defaultTags',
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
    const co = r.obj(c, path, ['x', 'y', 'faces']);
    const x = r.num(co, 'x', path);
    const y = r.num(co, 'y', path);
    if (!Number.isInteger(x) || !Number.isInteger(y)) r.fail(path, 'x and y must be integers');
    return { x, y, faces: faces(r, r.req(co, 'faces', path), `${path}.faces`) };
  });
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

  if (o.behavior !== undefined) def.behavior = r.str(o, 'behavior', '');
  if (o.behaviorConfig !== undefined) {
    const raw = o.behaviorConfig;
    const bc = r.obj(raw, 'behaviorConfig', typeof raw === 'object' && raw !== null ? Object.keys(raw) : []);
    const cfg: Record<string, number> = {};
    for (const k of Object.keys(bc)) cfg[k] = r.num(bc, k, 'behaviorConfig');
    def.behaviorConfig = cfg;
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
      const eo = r.obj(od.explode, 'onDestroyed.explode', ['radius', 'impulseRadius', 'impulse']);
      const p = 'onDestroyed.explode';
      def.onDestroyed = {
        explode: { radius: r.positive(eo, 'radius', p), impulseRadius: r.positive(eo, 'impulseRadius', p), impulse: r.positive(eo, 'impulse', p) },
      };
    } else {
      def.onDestroyed = {};
    }
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
  const so = r.obj(v, 'sprite', ['frame', 'mountFrame', 'animation', 'overlay']);
  const s: SpriteSpec = { frame: r.str(so, 'frame', 'sprite') };
  if (so.mountFrame !== undefined) s.mountFrame = r.str(so, 'mountFrame', 'sprite');
  if (so.animation !== undefined) s.animation = r.str(so, 'animation', 'sprite');
  if (so.overlay !== undefined) s.overlay = r.str(so, 'overlay', 'sprite');
  return s;
}

function joint(r: Reader, v: unknown, footprint: FootprintCell[]): JointSpec {
  const jo = r.obj(v, 'joint', ['kind', 'mountFace', 'motor']);
  if (jo.kind !== 'revolute') r.fail('joint.kind', 'must be "revolute"');
  if (!isFace(jo.mountFace)) r.fail('joint.mountFace', 'must be one of N, E, S, W');
  if (jo.motor !== 'velocity' && jo.motor !== 'position') r.fail('joint.motor', 'must be "velocity" or "position"');
  if (footprint.length !== 1) r.fail('joint', 'is only supported on one-cell parts');
  if (!footprint[0]?.faces.includes(jo.mountFace)) r.fail('joint.mountFace', `${jo.mountFace} is not an attachable face`);
  return { kind: 'revolute', mountFace: jo.mountFace, motor: jo.motor };
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
