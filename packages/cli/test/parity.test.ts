import { describe, expect, it } from 'vitest';
import type { ScriptHost, ScriptInput, ScriptInstance } from '@robots/sim-core';
import { GOLDEN_SCENES, runScene } from '../src/scenes';
import { scriptHost } from '../src/scriptHost';

/**
 * M9: on every script call in every golden scene, what the script actually holds (read back from inside the sandbox)
 * must be exactly what the old path gave it: `JSON.parse(JSON.stringify(input))` of the input the world built before
 * M9. Compared as JSON text, so key order counts too.
 */
describe('scripts see what they saw before M9', () => {
  for (const scene of GOLDEN_SCENES) {
    it(`${scene.name}: every call, every script`, { timeout: 120_000 }, async () => {
      const inner = await scriptHost();
      let expected = '';
      let calls = 0;
      const mismatches: string[] = [];
      const check = (instance: ScriptInstance, when: string): void => {
        calls++;
        const seen = instance.inspect?.() ?? '';
        if (seen !== expected && mismatches.length < 3) mismatches.push(`${when}\n  saw:      ${seen.slice(0, 600)}\n  expected: ${expected.slice(0, 600)}`);
      };
      const host: ScriptHost = {
        compile(source, opts) {
          const r = inner.compile(source, opts);
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
        expected = JSON.stringify(reference());
      };
      await runScene(scene, { scripts: host, scriptProbe });
      expect(mismatches).toEqual([]);
      if (scene.name !== 'car' && scene.name !== 'hopper' && scene.name !== 'longcar-bomb' && scene.name !== 'launcher') expect(calls).toBeGreaterThan(100);
    });
  }
});
