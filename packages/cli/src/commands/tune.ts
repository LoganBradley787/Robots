import { defaultRegistry, sampleRobot, staticStats, validateBlueprint, World, type RobotInput, type WorldFile } from '@robots/sim-core';

/** Open flat ground, no obstacles, so drives measure the robot and not the terrain. */
const TRACK: WorldFile = { name: 'tuning track', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] };

/** No bindings: auto controls drive them (D wheels, W upward thrusters). */
const car = (grid: string[]): unknown => ({ format: 1, name: 'tune', grid });
export const TUNE_ROBOTS: Record<string, unknown> = {
  car: car(['F  F  C  B  F  F', 'W  .  .  .  .  W']),
  heavy: car(['F  F  F  F  F  F', 'F  F  F  F  F  F', 'F  F  C  B  F  F', 'W  .  .  .  .  W']),
  big2: car(['F  F  F  F  F  F  F', 'F  F  F  C  F  F  F', 'W  .  .  .  .  .  W']),
  big4: car(['F  F  F  F  F  F  F', 'F  F  F  C  F  F  F', 'W  W  .  .  .  W  W']),
  hopper: car(['F  T^ C  B  T^ F', 'W  .  .  .  .  W']),
};

interface Drive {
  mass: number;
  speed: number[];
  y: number[];
}

/** Spawns on the track, settles 1 s, then runs `seconds` with key edges at the given seconds. Samples every tick. */
async function drive(bp: unknown, seconds: number, edges: { t: number; press?: string; release?: string }[]): Promise<Drive> {
  const w = await World.create({ seed: 1 }, TRACK);
  try {
    const robot = w.spawnBlueprint(bp, TRACK.spawn);
    for (let i = 0; i < 60; i++) w.step();
    const out: Drive = { mass: sampleRobot(w, robot).massKg, speed: [], y: [] };
    const ticks = Math.round(seconds / w.dt);
    for (let i = 0; i < ticks; i++) {
      const at = edges.filter((e) => Math.round(e.t / w.dt) === i);
      const inputs: RobotInput[] = at.length === 0 ? [] : [{ robot: robot.id, pressed: at.flatMap((e) => (e.press ? [e.press] : [])), released: at.flatMap((e) => (e.release ? [e.release] : [])) }];
      w.step(inputs);
      const s = sampleRobot(w, robot);
      out.speed.push(s.speed);
      out.y.push(s.coreY);
    }
    return out;
  } finally {
    w.dispose();
  }
}

const at = (d: Drive, t: number): number => d.speed[Math.round(t * 60) - 1] ?? Number.NaN;
const timeTo = (d: Drive, v: number, from = 0): number => {
  const i = d.speed.findIndex((s, k) => k >= from * 60 && s >= v);
  return i < 0 ? Number.POSITIVE_INFINITY : (i + 1) / 60 - from;
};
const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'never');

/** Prints the driving targets from docs/plans/M3-control.md, measured headless. */
export async function tune(): Promise<string> {
  const lines: string[] = [];
  const hold = [{ t: 0, press: 'd' }];
  const c = await drive(TUNE_ROBOTS.car, 12, hold);
  lines.push(`car      ${f(c.mass)} kg   1.5 s: ${f(at(c, 1.5))} m/s   4 s: ${f(at(c, 4))}   8 s: ${f(at(c, 8))}   12 s: ${f(at(c, 12))}   to 6 m/s: ${f(timeTo(c, 6))} s`);
  const h = await drive(TUNE_ROBOTS.heavy, 12, hold);
  lines.push(`heavy    ${f(h.mass)} kg   1.5 s: ${f(at(h, 1.5))} m/s   4 s: ${f(at(h, 4))}   8 s: ${f(at(h, 8))}   to 6 m/s: ${f(timeTo(h, 6))} s (car ${f(timeTo(c, 6))})`);
  for (const name of ['big2', 'big4']) {
    const b = await drive(TUNE_ROBOTS[name], 8, hold);
    lines.push(`${name.padEnd(8)} ${f(b.mass)} kg   5 s: ${f(at(b, 5))} m/s   to 5 m/s: ${f(timeTo(b, 5))} s`);
  }
  const coast = await drive(TUNE_ROBOTS.car, 6, [{ t: 0, press: 'd' }, { t: 4, release: 'd' }]);
  lines.push(`coast    at 4 s ${f(at(coast, 4))} m/s, 2 s later ${f(at(coast, 6))} m/s (${f((100 * (1 - at(coast, 6) / at(coast, 4))))}% lost)`);
  const brake = await drive(TUNE_ROBOTS.car, 10, [{ t: 0, press: 'd' }, { t: 4, release: 'd' }, { t: 4, press: 'a' }]);
  const stop = brake.speed.findIndex((s, k) => k >= 4 * 60 && s < 0.5);
  lines.push(`brake    from ${f(at(brake, 4))} m/s, under 0.5 m/s after ${stop < 0 ? 'never' : f((stop + 1) / 60 - 4)} s of A`);
  const hop = await drive(TUNE_ROBOTS.hopper, 2, [{ t: 0, press: 'w' }]);
  const y0 = hop.y[0] ?? 0;
  const off = hop.y.findIndex((y) => y > y0 + 0.2);
  lines.push(`hopper   ${f(hop.mass)} kg   core up 0.2 m after ${off < 0 ? 'never' : f((off + 1) / 60)} s, peak +${f(Math.max(...hop.y) - y0)} m in 2 s`);
  // Energy: how long a full pool lasts at full command (every consumer drawing its powerDraw).
  const reg = defaultRegistry();
  for (const name of ['car', 'hopper']) {
    const v = validateBlueprint(TUNE_ROBOTS[name], reg);
    if (!v.blueprint) continue;
    const st = staticStats(v.blueprint, reg);
    // Grouped by behavior, so every wheel-like or thrust-like part counts, whatever it is called.
    const byBehavior = (behavior: string): number =>
      v.blueprint!.parts.filter((p) => reg.get(p.part).behavior === behavior).reduce((sum, p) => sum + reg.get(p.part).powerDraw, 0);
    const driveDraw = byBehavior('wheel');
    const thrustDraw = byBehavior('thrust');
    lines.push(
      `energy   ${name}: ${st.energy} stored   ${driveDraw > 0 ? `driving ${Math.round(st.energy / driveDraw)} s` : ''}${thrustDraw > 0 ? `   full thrust ${Math.round(st.energy / thrustDraw)} s` : ''}`,
    );
  }
  return lines.join('\n');
}
