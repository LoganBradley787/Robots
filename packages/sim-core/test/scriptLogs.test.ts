import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';

/**
 * Each robot's own log lines (`World.logsOf`): the screen shows them for any robot it follows, an enemy included, so a
 * quiet robot's lines must outlast a crowd of chatty ones, and no robot keeps more than a few.
 */

const open = parseWorldFile({ name: 'open', ground: { width: 4000, thickness: 2 }, spawn: { x: 0, y: 3 }, boxes: [] });
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

const robot = (name: string, source: string): unknown => ({ format: 1, name, grid: ['C'], scripts: [{ id: 'talk', enabled: true, source }] });
const ONCE = `function tick() { if (frame === 1) log('hello from the quiet one'); }`;
const CHATTY = `function tick() { log('frame ' + frame); }`;

describe("each robot's log lines", () => {
  it("keep a quiet robot's line after the shared list has turned over, and keep at most 20 a robot", async () => {
    const w = await World.create({ seed: 1, scripts: host }, open);
    const quiet = w.spawnBlueprint(robot('quiet', ONCE), { x: 0, y: 1 });
    const chatty = Array.from({ length: 20 }, (_, i) => w.spawnBlueprint(robot(`chatty ${i}`, CHATTY), { x: 10 + 5 * i, y: 1 }));
    for (let i = 0; i < 60; i++) w.step();
    expect(w.scriptLogs.some((l) => l.robot === quiet.id)).toBe(false);
    expect(w.logsOf(quiet.id).map((l) => l.text)).toEqual(['hello from the quiet one']);
    const one = chatty[0];
    if (!one) throw new Error('no chatty robot');
    const own = w.logsOf(one.id);
    expect(own.length).toBe(20);
    expect(own.every((l) => l.robot === one.id)).toBe(true);
    // Oldest first, the newest last.
    expect(own.map((l) => l.tick)).toEqual([...own.map((l) => l.tick)].sort((a, b) => a - b));
    expect(own.at(-1)?.text).toBe(w.scriptLogs.filter((l) => l.robot === one.id).at(-1)?.text);
    // A robot that goes takes its lines with it.
    w.removeRobots([quiet.id]);
    w.step();
    expect(w.logsOf(quiet.id)).toEqual([]);
    w.dispose();
  });
});
