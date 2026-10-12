/** How many letters must be dropped, added, changed, or swapped with a neighbor to turn `a` into `b`. */
export function editDistance(a: string, b: string): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let d = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (before[j - 2] ?? 0) + 1);
      row.push(d);
    }
    before = prev;
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/**
 * The names a mistyped `word` most likely meant, for "did you mean" in error messages: nearest first, ties in the
 * order given, at most `max`. A name counts when it starts with the word, or is within a third of the word's letters
 * (at least 2) of it without every letter changing. Empty when nothing is close, so a message never guesses wildly.
 */
export function nearestNames(word: string, names: readonly string[], max = 1): string[] {
  const reach = Math.max(2, Math.floor(word.length / 3));
  const scored: { name: string; d: number }[] = [];
  for (const name of new Set(names)) {
    if (name === word) continue;
    const d = word.length >= 2 && name.startsWith(word) ? 1 : editDistance(word, name);
    if (d <= reach && d < word.length) scored.push({ name, d });
  }
  // A stable sort, so ties keep the order the names came in.
  return scored.sort((p, q) => p.d - q.d).slice(0, max).map((s) => s.name);
}
