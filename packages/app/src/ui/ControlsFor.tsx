import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Segmented } from './kit';

/** Shown at the top of Keys and Behaviors when the robot has more than one core (M7): whose controls you edit. */
export function ControlsFor({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'setControlsFor'> }) {
  const cores = useStore(store, (s) => s.builder.cores);
  const current = useStore(store, (s) => s.builder.controlsFor);
  if (cores.length < 2) return null;
  return (
    <div class="row" title="a placed robot's core runs its own keys and scripts when its piece breaks off">
      <Segmented options={cores.map((c) => ({ value: c.core ?? '', label: c.label }))} value={current ?? ''} onChange={(v) => actions.setControlsFor(v === '' ? undefined : v)} />
    </div>
  );
}
