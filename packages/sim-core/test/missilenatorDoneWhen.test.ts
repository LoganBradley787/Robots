import { beforeAll, describe, expect, it } from 'vitest';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import flatJson from '../../../worlds/flat.json';
import { createQuickJsHost } from '../src/script/quickjs';
import type { ScriptHost } from '../src/script/types';
import { parseWorldFile } from '../src/world/WorldFile';
import { World } from '../src/world/World';
import { resolveScripts } from '../src/blueprint/scripts';

const flat = parseWorldFile(flatJson);
let host: ScriptHost;
beforeAll(async () => {
  host = await createQuickJsHost(variant);
});
const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
const blueprint = (name: string): unknown => resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;

describe('missilenator, done when', () => {
  it('the enemy silo builds a missilenator in its 10 wide bay, lets it go at a hovering hunter drone 400 m off, and it wrecks it', { timeout: 120_000 }, async () => {
    const w = await World.create({ seed: 1, scripts: host }, flat);
    const hunter = w.spawnBlueprint(blueprint('hunter-drone'), { x: 0, y: 40 });
    const silo = w.spawnBlueprint(blueprint('enemy-missilenator-silo'), { x: 400, y: 1.55 }, { team: 1 });
    // Built in about 41 s; it flies 400 m in under 10.
    for (let t = 0; t < 55 * 60; t++) w.step();
    expect(w.events.filter((e) => e.kind === 'released' && e.robot === silo.id)).toHaveLength(1);
    // Rammed and blown apart: most of its 69 parts, its core among them. Titans: 60 or more before (68, every part at
    // once), when the ram's crash hurt the whole body; crash damage is local now, so the parts over 6 m from where it
    // hit are left to the blasts, and 52 go.
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === hunter.id).length).toBeGreaterThanOrEqual(45);
    expect(w.robots.find((r) => r.id === hunter.id)?.primaryCoreId).toBeUndefined();
    expect(w.events.filter((e) => e.kind === 'coreLost' && e.robot === hunter.id)).toHaveLength(1);
    // The silo is untouched and never tips.
    expect(w.events.filter((e) => e.kind === 'partDestroyed' && e.robot === silo.id)).toHaveLength(0);
    w.dispose();
  });
});
