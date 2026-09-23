import { useEffect, useState } from 'preact/hooks';

/** A tiny observable store: the tick loop and the builder write it, UI components read it. */
export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T> | ((prev: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-renders when the selected value changes (compared with Object.is). */
export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  const [value, setValue] = useState(() => select(store.get()));
  useEffect(() => {
    const update = (): void => setValue(() => select(store.get()));
    update();
    return store.subscribe(update);
  }, [store]);
  return value;
}
