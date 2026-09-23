import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export interface WorldActions {
  worldTogglePause(): void;
  worldStep(): void;
  worldSlower(): void;
  worldFaster(): void;
  worldCamera(): void;
  worldHome(): void;
  worldToggleDebug(): void;
  worldToggleGrid(): void;
  worldReset(): void;
  saveReplay(): void;
  toBuilder(): void;
}

/** Every world control as a button, with its key. Reset is only here, and it asks first. */
export function WorldToolbar({ store, actions }: { store: Store<AppState>; actions: WorldActions }) {
  const v = useStore(store, (s) => s.world);
  if (!v) return null;
  return (
    <div class="world-toolbar panel">
      <button onClick={actions.toBuilder} title="Tab">
        Builder <kbd>Tab</kbd>
      </button>
      <span class="sep" />
      <button onClick={actions.worldTogglePause}>
        {v.paused ? 'Play' : 'Pause'} <kbd>Space</kbd>
      </button>
      <button onClick={actions.worldStep}>
        Step <kbd>.</kbd>
      </button>
      <button onClick={actions.worldSlower} aria-label="slower">
        <kbd>[</kbd>
      </button>
      <span class="speed">x{v.timeScale}</span>
      <button onClick={actions.worldFaster} aria-label="faster">
        <kbd>]</kbd>
      </button>
      <span class="sep" />
      <button onClick={actions.worldCamera} disabled={v.robots === 0} title={v.follow ? 'next robot' : 'follow again'}>
        {v.follow ? 'Next robot' : 'Follow'} <kbd>,</kbd>
      </button>
      <button onClick={actions.worldHome} title="Camera back to the drop point">
        Home
      </button>
      <button class={v.debug ? 'on' : ''} onClick={actions.worldToggleDebug}>
        Debug <kbd>\</kbd>
      </button>
      <button class={v.grid ? 'on' : ''} onClick={actions.worldToggleGrid}>
        Grid <kbd>`</kbd>
      </button>
      <span class="sep" />
      <button onClick={actions.saveReplay} disabled={v.robots === 0} title="Save this run to replays/ so the headless runner can rerun it exactly">
        Save replay
      </button>
      <button class="danger" onClick={actions.worldReset} disabled={v.robots === 0}>
        Clear robots
      </button>
    </div>
  );
}
