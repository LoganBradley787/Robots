/**
 * Keys the app keeps for itself (Gate 2: world controls use punctuation; Tab and Escape switch and cancel), by
 * `KeyboardEvent.code`. A binding on one of these never reaches the robot. `packages/app/src/app/keys.ts` has the
 * actions and a test keeps the two lists in step.
 */
export const WORLD_KEY_CODES: readonly string[] = ['Space', 'Period', 'BracketLeft', 'BracketRight', 'Backslash', 'Backquote', 'Comma', 'Tab', 'Escape'];

/**
 * Why a key name can never fire on a robot, with the fix, or undefined when it is fine. Key names come from the
 * physical key: `a` and `1` for letters and digits, else the `KeyboardEvent.code` (`ArrowUp`, `ShiftLeft`).
 */
export function keyProblem(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `key '${key}' should be written '${key.toLowerCase()}' (letters are lower case)`;
  const letter = /^Key([A-Z])$/.exec(key);
  if (letter) return `key '${key}' should be written '${(letter[1] ?? '').toLowerCase()}'`;
  const digit = /^Digit([0-9])$/.exec(key);
  if (digit) return `key '${key}' should be written '${digit[1] ?? ''}'`;
  if (WORLD_KEY_CODES.includes(key)) return `key '${key}' belongs to the world (world controls use punctuation), so it never reaches the robot`;
  if (/^[a-z0-9]$/.test(key) || /^[A-Z][A-Za-z0-9]+$/.test(key)) return undefined;
  return `key '${key}' is not a key name: use a letter or digit ('d', '1') or a KeyboardEvent.code ('ArrowUp')`;
}
