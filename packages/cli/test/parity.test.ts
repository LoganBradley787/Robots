import { describe, expect, it } from 'vitest';
import type { ScriptHost, ScriptInput, ScriptInstance } from '@robots/sim-core';
import { GOLDEN_SCENES, runScene } from '../src/scenes';
import { scriptHost } from '../src/scriptHost';

/**
 * M9: on every script call in every golden scene, what the script actually holds (read back from inside the sandbox,
 * just before it runs) must be exactly what the old path gave it: `JSON.parse(JSON.stringify(input))` of the input the
 * world built before M9. Compared as JSON text (the sandbox's text re-printed by Node, so numbers print the same way), so
 * key order counts too.
 *
 * M16: the input now carries each part's `spec` (its definition's static numbers, `script/partSpec.ts`), sent with the
 * layout and not per tick. The comparison is the same, on more: every part of every call must hold the spec the
 * reference gives it, as its last key, whether the part came from a whole layout or a patch.
 */
describe('scripts see what they saw before M9', () => {
  for (const scene of GOLDEN_SCENES) {
    it(`${scene.name}: every call, every script`, { timeout: 120_000 }, async () => {
      const inner = await scriptHost();
      let expected = '';
      let calls = 0;
      /** Calls whose reference had a part without its spec: the comparison below would then prove nothing about specs. */
      let unspecced = 0;
      const mismatches: string[] = [];
      const check = (instance: ScriptInstance, when: string): void => {
        calls++;
        // Re-printed by Node: the sandbox (QuickJS) prints some doubles with more digits than Node does for the same
        // value (-2^-24 as -5.9604644775390625e-8, Node -5.960464477539063e-8). Key order still counts.
        const raw = instance.inspect?.() ?? '';
        const seen = raw === '' ? raw : JSON.stringify(JSON.parse(raw));
        if (seen !== expected && mismatches.length < 3) mismatches.push(`${when}\n  saw:      ${seen.slice(0, 600)}\n  expected: ${expected.slice(0, 600)}`);
      };
      const host: ScriptHost = {
        compile(source, opts) {
          const r = inner.compile(source, { ...opts, inspect: true });
          if (!r.ok) return r;
          const i = r.instance;
          return {
            ok: true,
            instance: {
              params: i.params,
              setup: (frame, services) => {
                const out = i.setup(frame, services);
                if (out.ok) check(i, `${opts.name} setup`);
                return out;
              },
              tick: (frame, services) => {
                const out = i.tick(frame, services);
                if (out.ok) check(i, `${opts.name} tick`);
                return out;
              },
              dispose: () => i.dispose(),
              inspect: () => i.inspect?.() ?? '',
            },
          };
        },
      };
      const scriptProbe = (_robot: number, reference: () => ScriptInput): void => {
        const input = reference();
        if (input.parts.some((p) => p.spec === undefined || typeof p.spec.maxHealth !== 'number' || typeof p.spec.in !== 'object')) unspecced++;
        expected = JSON.stringify(input);
      };
      await runScene(scene, { scripts: host, scriptProbe });
      expect(mismatches).toEqual([]);
      expect(unspecced).toBe(0);
      if (scene.name !== 'car' && scene.name !== 'hopper' && scene.name !== 'longcar-bomb' && scene.name !== 'launcher') expect(calls).toBeGreaterThan(100);
    });
  }
});
