import { useEffect, useRef, useState } from 'preact/hooks';
import { codeOf } from '../app/keys';
import { keyName } from '../builder/bindings';
import { refusal } from '../builder/keys';

/** How many key waits are running: while one is, the builder screen's own keys (`?`, Esc) leave the press to it. */
let waits = 0;

/** Whether some key cap is waiting for a key. */
export function keyWaitActive(): boolean {
  return waits > 0;
}

/** Marks a key wait as running until the function it gives back is called. */
export function claimKeys(): () => void {
  waits++;
  let done = false;
  return () => {
    if (!done) waits--;
    done = true;
  };
}

/** What one press does to a key wait. */
export type WaitStep = { kind: 'pass' } | { kind: 'stop' } | { kind: 'ignore' } | { kind: 'refuse'; why: string } | { kind: 'key'; key: string };

/**
 * A press while waiting: Cmd or Ctrl with anything calls the wait off and is left to do what it always does (Cmd+Z
 * undoes, Cmd+S saves, Cmd+R reloads); Esc calls it off; a modifier on its own changes nothing; a key the world keeps
 * is refused with the reason; any other key is the answer.
 */
export function waitStep(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey'>): WaitStep {
  if (e.metaKey || e.ctrlKey) return { kind: 'pass' };
  if (e.key === 'Escape') return { kind: 'stop' };
  if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return { kind: 'ignore' };
  const code = codeOf(e);
  if (code === '') return { kind: 'ignore' };
  const why = refusal(code);
  if (why !== undefined) return { kind: 'refuse', why };
  return { kind: 'key', key: keyName({ code }) };
}

/**
 * Waiting for a key (M16): click a key cap, and the next key pressed anywhere is the answer. Esc, a click on the
 * same cap again, or a press anywhere else calls it off. A key the world keeps is refused with the reason and the
 * wait goes on, so the next key can be the right one.
 *
 * The cap that is waiting carries `data-waitcap` (spread `capProps(id)` on it), so the press that would call the wait
 * off is told apart from the click that asks for exactly that.
 */
export function useKeyWait<T extends string | number>(onKey: (id: T, key: string) => void): {
  waiting: T | undefined;
  refused: string | undefined;
  /** Starts waiting for `id`, or stops when it is the one waiting already. */
  toggle(id: T): void;
  cancel(): void;
  capProps(id: T): { 'data-waitcap': string; onClick(): void };
} {
  const [waiting, setWaiting] = useState<T | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  // The newest callback, so a wait that started before a re-render still writes to the list as it is now.
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    if (waiting === undefined) return;
    const release = claimKeys();
    const key = (e: KeyboardEvent): void => {
      const step = waitStep(e);
      if (step.kind === 'pass') {
        setRefused(undefined);
        setWaiting(undefined);
        return;
      }
      e.preventDefault();
      // No other listener on the window gets it (the builder's `?` and Esc): the press is the wait's.
      e.stopImmediatePropagation();
      if (step.kind === 'ignore') return;
      if (step.kind === 'refuse') return setRefused(step.why);
      setRefused(undefined);
      setWaiting(undefined);
      if (step.kind === 'key') latest.current(waiting, step.key);
    };
    const away = (e: PointerEvent): void => {
      // The waiting cap's own click calls it off (below): closing here too would start it again.
      if ((e.target as HTMLElement | null)?.closest?.('[data-waitcap]')) return;
      setWaiting(undefined);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      release();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [waiting]);
  const toggle = (id: T): void => {
    setRefused(undefined);
    setWaiting((w) => (w === id ? undefined : id));
  };
  return { waiting, refused, toggle, cancel: () => setWaiting(undefined), capProps: (id) => ({ 'data-waitcap': String(id), onClick: () => toggle(id) }) };
}
