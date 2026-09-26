import { describe, expect, it } from 'vitest';
import type { ScriptHost, ScriptResult } from '@robots/sim-core';
import { bench, formatBench } from '../src/commands/bench';
import { timedHost } from '../src/timedHost';

describe('timedHost', () => {
  it('sums the time and calls spent in setup and tick, and take() resets them', () => {
    const ok: ScriptResult = { ok: true, writes: [], logs: [], marks: [] };
    const inner: ScriptHost = {
      compile: () => ({ ok: true, instance: { params: {}, setup: () => ok, tick: () => ok, dispose: () => undefined } }),
    };
    let t = 0;
    const { host, clock } = timedHost(inner, () => (t += 2));
    const r = host.compile('', { name: 'x', seed: 1 });
    if (!r.ok) throw new Error('compile failed');
    const frame = {} as Parameters<typeof r.instance.tick>[0];
    r.instance.setup(frame);
    r.instance.tick(frame);
    r.instance.tick(frame);
    expect(clock.take()).toEqual({ ms: 6, calls: 3 });
    expect(clock.take()).toEqual({ ms: 0, calls: 0 });
  });

  it('passes compile errors through untouched', () => {
    const inner: ScriptHost = { compile: () => ({ ok: false, error: { kind: 'compile', message: 'no tick' } }) };
    expect(timedHost(inner).host.compile('', { name: 'x', seed: 1 })).toEqual({ ok: false, error: { kind: 'compile', message: 'no tick' } });
  });
});

describe('bench', () => {
  it('times one hovering drone and reports scripts, the rest, calls, and a hash', { timeout: 60_000 }, async () => {
    const [row] = await bench({ scene: 'hover', n: 1, seconds: 0.2 });
    expect(row?.ticks).toBe(12);
    expect(row?.callsPerTick).toBe(2);
    expect(row?.scriptMs).toBeGreaterThan(0);
    expect(row?.avgMs).toBeGreaterThanOrEqual(row?.scriptMs ?? Infinity);
    expect(row?.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(formatBench(row ? [row] : [])).toContain('hover      1');
  });

  it('gives the same hash twice (a bench run doubles as a determinism check)', { timeout: 60_000 }, async () => {
    const [a] = await bench({ scene: 'battle', n: 1, seconds: 0.5 });
    const [b] = await bench({ scene: 'battle', n: 1, seconds: 0.5 });
    expect(a?.hash).toBe(b?.hash);
    expect(a?.callsPerTick).toBeGreaterThan(0);
  });
});
