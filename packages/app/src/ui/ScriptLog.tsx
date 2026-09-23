import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

/** The controlled robot's scripts and their latest log lines (M5). Hidden when the robot has no scripts. */
export function ScriptLog({ store }: { store: Store<AppState> }) {
  const c = useStore(store, (s) => s.world?.controlled);
  if (!c || c.scripts.length === 0) return null;
  return (
    <div class="script-log panel">
      {c.scripts.map((s) => (
        <div key={s.id} class={`script-state ${s.state}`} title={s.error ?? ''}>
          <span class="dot" /> {s.id} {s.state === 'crashed' ? `stopped: ${s.error ?? ''}` : s.state}
        </div>
      ))}
      {c.logs.map((l, i) => (
        <div key={i} class="log-line">
          {l}
        </div>
      ))}
    </div>
  );
}
