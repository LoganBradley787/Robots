import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export function App({ store }: { store: Store<AppState> }) {
  const mode = useStore(store, (s) => s.mode);
  return <div class="mode-badge">{mode === 'builder' ? 'Builder   (Tab: world)' : 'World   (Tab: builder)'}</div>;
}
