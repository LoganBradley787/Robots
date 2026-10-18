import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M16: `sim-core` never calls a `Math` function the engine may approximate (`01`, Determinism). Chrome and Node gave
 * different `Math.cos` bits and a replay parted at tick 35. The functions here are exact in every engine (IEEE 754 or
 * integer results); for sin, cos, atan2, asin and hypot use `src/math/fdlibm.ts`, for a whole power `powInt` (not `**`).
 * Comments are left out, so a comment may still name `Math.cos`.
 */
const EXACT = new Set(['abs', 'ceil', 'clz32', 'floor', 'fround', 'imul', 'max', 'min', 'round', 'sign', 'sqrt', 'trunc']);
const CONSTANTS = new Set(['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2']);
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

/** The code without its comments: block comments, and line comments that start a line or follow a space. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('host Math in sim-core', () => {
  it('calls only exact Math functions, and no ** or Math.pow', () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        const where = `${relative(SRC, file)}:${i + 1}`;
        for (const m of line.matchAll(/\bMath\s*(?:\.\s*(\w+)|\[)/g)) {
          const name = m[1];
          if (name === undefined) found.push(`${where}: Math[...]`);
          else if (!EXACT.has(name) && !CONSTANTS.has(name)) found.push(`${where}: Math.${name}`);
        }
        if (/[\w)\]]\s*\*\*\s*[\w(.-]/.test(line) || /\*\*=/.test(line)) found.push(`${where}: **`);
      });
    }
    expect(found, `use src/math/fdlibm.ts (sin, cos, atan, atan2, asin, hypot, powInt) instead:\n${found.join('\n')}`).toEqual([]);
  });

  it('notices a call it must refuse', () => {
    const sample = code('const a = Math.cos(t); // Math.sin here is fine\n/** Math.tan too */ const b = x ** 2;');
    expect(sample).toContain('Math.cos');
    expect(sample).not.toContain('Math.sin');
    expect(sample).not.toContain('Math.tan');
    expect(/[\w)\]]\s*\*\*\s*[\w(.-]/.test(sample)).toBe(true);
  });
});
