import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export interface KeysBarActions {
  /** A keys bar button went down or up: acts exactly like the keyboard key. */
  robotKeyDown(key: string): void;
  robotKeyUp(key: string): void;
}

/** How a key name shows on a button: letters upper case, codes as they are (`Space`, `ArrowUp`). */
function label(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, '').replace(/^Numpad/, 'Num ');
}

/**
 * The controlled robot's keys (`11`): letters only, no descriptions. Lit while held; toggle keys show a dot when on.
 * Pressing a button holds its key until the pointer lets go or leaves, so a click taps and a press holds.
 */
export function KeysBar({ store, actions }: { store: Store<AppState>; actions: KeysBarActions }) {
  const c = useStore(store, (s) => s.world?.controlled);
  const unlimited = useStore(store, (s) => s.world?.unlimitedEnergy ?? false);
  if (!c || (c.keys.length === 0 && !c.energy)) return null;
  const e = c.energy;
  const pct = e?.percent ?? 0;
  return (
    <div class="keys-bar panel" title={`${c.name}'s keys`}>
      {e && (
        <div class="energy" title={unlimited ? 'unlimited energy is on' : `${pct}% of ${e.capacity} energy`}>
          <div class="energy-track">
            <div class={`energy-fill${pct < 15 ? ' low' : ''}${unlimited ? ' unlimited' : ''}`} style={{ width: `${unlimited ? 100 : pct}%` }} />
          </div>
          <span class="energy-text">{unlimited ? 'unlimited' : e.capacity === 0 ? 'no energy' : `${pct}%`}</span>
        </div>
      )}
      {c.keys.map((k) => (
        <button
          key={k.key}
          tabIndex={-1}
          class={`robot-key${k.held ? ' held' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            actions.robotKeyDown(k.key);
            // Keep the key held if the pointer slides off the button; it lets go on release anywhere.
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              // A pointer that is not active (synthetic events) cannot be captured; pointerup still releases.
            }
          }}
          onPointerUp={() => actions.robotKeyUp(k.key)}
          onPointerCancel={() => actions.robotKeyUp(k.key)}
          onLostPointerCapture={() => actions.robotKeyUp(k.key)}
        >
          {label(k.key)}
          {k.toggle && <span class={k.on ? 'toggle-dot on' : 'toggle-dot'} />}
        </button>
      ))}
    </div>
  );
}
