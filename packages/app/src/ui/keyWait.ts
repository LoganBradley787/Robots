import { useEffect, useRef, useState } from 'preact/hooks';
import { codeOf } from '../app/keys';
import { keyName } from '../builder/bindings';
import { refusal } from '../builder/keys';

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
    const key = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRefused(undefined);
        setWaiting(undefined);
        return;
      }
      if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
      const code = codeOf(e);
      if (code === '') return;
      const why = refusal(code);
      if (why !== undefined) {
        setRefused(why);
        return;
      }
      setRefused(undefined);
      setWaiting(undefined);
      latest.current(waiting, keyName({ code }));
    };
    const away = (e: PointerEvent): void => {
      // The waiting cap's own click calls it off (below): closing here too would start it again.
      if ((e.target as HTMLElement | null)?.closest?.('[data-waitcap]')) return;
      setWaiting(undefined);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
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
