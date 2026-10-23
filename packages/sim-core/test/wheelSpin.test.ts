import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';

/** Open ground, so the car drives and never meets a wall. */
const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

/** A car whose script drives forward and logs what its wheels report. */
const CAR = {
  format: 1,
  name: 'spin car',
  grid: ['F  F  C  F  F', 'W  .  .  .  W'],
  legend: { W: { part: 'wheel', tags: ['wheels'] } },
  scripts: [{ id: 'go', source: "function tick() { set('wheels', 'speed', 1); if (frame % 30 === 0) log(String(get('wheels', 'angularVelocity'))); }" }],
};

describe("the wheel's angularVelocity output", () => {
  it("is the wheel's spin against the body it is mounted on, in radians a second, counterclockwise positive", async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const r = w.spawnBlueprint(CAR, { x: 0, y: 1.5 });
    for (let i = 0; i < 120; i++) w.step();
    const wheel = r.parts.get('wheel@0,0');
    const hull = r.groups[0];
    const own = wheel ? r.groups[wheel.group] : undefined;
    if (!wheel || !hull || !own) throw new Error('no wheel');
    const spin = w.physics.state(own.bodyId).w - w.physics.state(hull.bodyId).w;
    // Forward (+1) rolls toward +x: clockwise, so negative.
    expect(spin).toBeLessThan(-5);
    expect(w.partOutput(r.id, 'wheel@0,0', 'angularVelocity')).toBe(spin);
    // A script reads it too.
    const logged = w.scriptLogs.map((l) => Number(l.text));
    expect(logged.length).toBeGreaterThan(2);
    expect(logged[logged.length - 1]).toBeLessThan(-5);
    w.dispose();
  });
});
