/**
 * Orders two strings by their code units, for a sort's tie break. Never `localeCompare` in the simulation: its order
 * depends on the machine's locale (review D1), and a tie decides which part takes a shell.
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
