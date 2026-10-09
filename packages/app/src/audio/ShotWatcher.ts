/**
 * Finds the shots fired since it last looked (M15). The sim logs no event per shot (ten a second per gun), but every
 * shot is a new shell object, so a shell not seen before is a shot. Generic so tests pass plain objects.
 */
export class ShotWatcher<T extends object> {
  private seen = new WeakSet<T>();

  fresh(shells: Iterable<T>): T[] {
    const out: T[] = [];
    for (const s of shells) {
      if (this.seen.has(s)) continue;
      this.seen.add(s);
      out.push(s);
    }
    return out;
  }

  /** Marks shells as seen without reporting them (a world that already has shells in flight). */
  skip(shells: Iterable<T>): void {
    for (const s of shells) this.seen.add(s);
  }
}
