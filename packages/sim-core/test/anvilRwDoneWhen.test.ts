import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import arenaJson from '../../../worlds/arena.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { resolveScripts } from '../src/blueprint/scripts';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { MATCH_ARENA } from '../src/world/arena';
import type { PartInstance, Robot } from '../src/world/Robot';

/**
 * titan-anvil-rw's repair script: a brick that rams loses a face at a time. Measured when written: its left six
 * columns shot (267 parts), it made back 250 in 25 s and stayed one piece.
 */
const arena = parseWorldFile(arenaJson);
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const raw = resolveScripts(JSON.parse(bpFile('titan-anvil-rw.json')), bpFile).raw as Record<string, unknown>;
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});

async function alone(): Promise<{ w: World; r: Robot }> {
  const w = await World.create({ seed: 1, scripts: host, arena: MATCH_ARENA }, arena);
  const r = w.spawnBlueprint(raw, { x: -400, y: 60 }, { team: 0 });
  for (let i = 0; i < 5 * 60; i++) w.step();
  return { w, r };
}
const steps = (w: World, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) w.step();
};

describe('titan-anvil-rw: the repair script', () => {
  it('a face shot off comes back; it pays with jammers and batteries, never a booster or a plate, and stays one piece', async () => {
    const { w, r } = await alone();
    const hit = [...r.parts.values()].filter((p: PartInstance) => p.x <= 6 && p.def.id !== 'core');
    for (const p of hit) p.health = 0;
    steps(w, 25);
    const mine = w.events.filter((e) => e.robot === r.id);
    expect(mine.filter((e) => e.kind === 'partRebuilt').length).toBeGreaterThan(150);
    const sold = mine.flatMap((e) => (e.kind === 'partScrapped' ? [e.partType] : []));
    expect(sold.length).toBeGreaterThan(0);
    expect(sold).not.toContain('booster');
    expect(sold).not.toContain('armorplate');
    // The shot face may break off; nothing it sold does.
    const scrapTicks = new Set(mine.flatMap((e) => (e.kind === 'partScrapped' ? [e.tick] : [])));
    const selfSplits = mine.filter((e) => e.kind === 'split' && scrapTicks.has(e.tick) && e.pieces.some((id) => (w.robots.find((x) => x.id === id)?.parts.size ?? 0) > 20));
    expect(selfSplits).toHaveLength(0);
    w.dispose();
  }, 240000);
});
