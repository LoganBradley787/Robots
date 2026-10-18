import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The lifter hunter's `bodyAngle` (review 2026-10-18): which way the target's body points, from a scan of its lifters.
 * It looked for the target's core, which that scan (`has: 'throttle'`) never returns, so it always took the first
 * lifter's body, which on a robot with a lifter on a hinge or a piece of its own is not the body.
 */
const COPIES = ['lifter-hunter.pilot.js', 'enemy-lifter-hunter.pilot.js', 'enemy-hunter-carrier.lifter-hunter.pilot.js'];
const text = (f: string): string => readFileSync(new URL(`../../../blueprints/${f}`, import.meta.url), 'utf8');
const body = (f: string): string => /\nfunction bodyAngle\(list\) \{\n[\s\S]*?\n\}\n/.exec(text(f))?.[0] ?? '';
// Plain JavaScript with nothing from the sandbox: run as it is.
const bodyAngle = new Function(`${body(COPIES[0] as string)}\nreturn bodyAngle;`)() as (list: { type: string; angle: number }[]) => number;

describe('lifter hunter: which way its target points', () => {
  it('is the same in every copy of the script', () => {
    expect(body(COPIES[0] as string)).toContain('function bodyAngle');
    for (const f of COPIES) expect(body(f), f).toBe(body(COPIES[0] as string));
  });

  it('is the angle most of the scanned parts share, not the first one', () => {
    const lifter = (angle: number) => ({ type: 'thruster', angle });
    // The first lifter swings on a hinge; the other three are on the body.
    expect(bodyAngle([lifter(0.7), lifter(0.1), lifter(0.1), lifter(0.1)])).toBe(0.1);
    // All on one body, as on most robots: that body, as before.
    expect(bodyAngle([lifter(-0.25), lifter(-0.25)])).toBe(-0.25);
    // A tie goes to the angle that reached that count first.
    expect(bodyAngle([lifter(0.3), lifter(0.2), lifter(0.2), lifter(0.3)])).toBe(0.2);
    expect(bodyAngle([])).toBe(0);
  });
});
