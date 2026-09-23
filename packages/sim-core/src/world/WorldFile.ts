import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';

export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
  angleDeg: number;
  dynamic: boolean;
  mass: number;
}

export interface WorldFile {
  name: string;
  ground: { width: number; thickness: number };
  boxes: WorldBox[];
  spawn: { x: number; y: number };
}

export class WorldFileError extends Error {}

function record(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WorldFileError(`${path} must be an object`);
  return v as Record<string, unknown>;
}

/** Unknown keys are errors, not silently ignored, so a typo in a hand- or AI-written file is caught. */
function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new WorldFileError(`${path}.${key} is not a known field (expected one of: ${allowed.join(', ')})`);
    }
  }
}

function bool(obj: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new WorldFileError(`${path}.${key} must be true or false`);
  return v;
}

function num(obj: Record<string, unknown>, key: string, path: string, fallback?: number): number {
  const v = obj[key];
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    throw new WorldFileError(`${path}.${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WorldFileError(`${path}.${key} must be a finite number`);
  return v;
}

function positive(obj: Record<string, unknown>, key: string, path: string, fallback?: number): number {
  const v = num(obj, key, path, fallback);
  if (v <= 0) throw new WorldFileError(`${path}.${key} must be greater than 0`);
  return v;
}

export function parseWorldFile(raw: unknown): WorldFile {
  const root = record(raw, 'world');
  onlyKeys(root, ['name', 'ground', 'spawn', 'boxes'], 'world');
  if (root.name !== undefined && typeof root.name !== 'string') throw new WorldFileError('world.name must be a string');
  const name = root.name ?? 'unnamed';
  const ground = record(root.ground, 'world.ground');
  onlyKeys(ground, ['width', 'thickness'], 'world.ground');
  const spawn = record(root.spawn, 'world.spawn');
  onlyKeys(spawn, ['x', 'y'], 'world.spawn');
  const boxesRaw = root.boxes === undefined ? [] : root.boxes;
  if (!Array.isArray(boxesRaw)) throw new WorldFileError('world.boxes must be an array');
  const boxes: WorldBox[] = boxesRaw.map((b, i) => {
    const path = `world.boxes[${i}]`;
    const o = record(b, path);
    onlyKeys(o, ['x', 'y', 'w', 'h', 'angleDeg', 'dynamic', 'mass'], path);
    return {
      x: num(o, 'x', path),
      y: num(o, 'y', path),
      w: positive(o, 'w', path),
      h: positive(o, 'h', path),
      angleDeg: num(o, 'angleDeg', path, 0),
      dynamic: bool(o, 'dynamic', path, false),
      mass: positive(o, 'mass', path, 1),
    };
  });
  return {
    name,
    ground: { width: positive(ground, 'width', 'world.ground'), thickness: positive(ground, 'thickness', 'world.ground', 2) },
    boxes,
    spawn: { x: num(spawn, 'x', 'world.spawn'), y: num(spawn, 'y', 'world.spawn') },
  };
}

/** Creates the static ground (top surface at y = 0) and every box. Order is fixed so body ids are stable. */
export function buildWorld(physics: PhysicsWorld, file: WorldFile): { groundId: BodyId; boxIds: BodyId[] } {
  const groundId = physics.createFixedBox(0, -file.ground.thickness / 2, file.ground.width, file.ground.thickness);
  const boxIds = file.boxes.map((b) => {
    const angle = (b.angleDeg * Math.PI) / 180;
    return b.dynamic
      ? physics.createDynamicBox(b.x, b.y, b.w, b.h, b.mass, angle)
      : physics.createFixedBox(b.x, b.y, b.w, b.h, angle);
  });
  return { groundId, boxIds };
}
