import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Segmented } from './kit';

/** "missile1 (core@5,5)" is "missile1" on the control; the core's own name is in its tooltip. */
const shortLabel = (label: string): string => label.replace(/ \([^)]*\)$/, '');

/** Shown at the top of Keys and Behaviors when the robot has more than one core (M7): whose controls you edit. */
export function ControlsFor({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'setControlsFor'> }) {
  const cores = useStore(store, (s) => s.builder.cores);
  const current = useStore(store, (s) => s.builder.controlsFor);
  if (cores.length < 2) return null;
  return (
    <div class="cores-for" title="A placed robot's core runs its own keys and scripts when its piece breaks off. This picks whose you edit.">
      <span class="lbl">for</span>
      <Segmented options={cores.map((c) => ({ value: c.core ?? '', label: shortLabel(c.label), title: c.core === undefined ? "The robot's own core" : `The core ${c.core}` }))} value={current ?? ''} onChange={(v) => actions.setControlsFor(v === '' ? undefined : v)} />
    </div>
  );
}
