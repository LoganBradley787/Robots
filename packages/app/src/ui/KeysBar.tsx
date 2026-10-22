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
 * The followed robot's energy and, when you control it, its keys (`11`), as key caps just above the transport: letters
 * only, no descriptions. Lit while held; toggle keys show a dot when on. A robot you only watch (an enemy) shows its
 * energy and no keys: it cannot be driven. Pressing a button holds its key until the pointer lets go or leaves, so a
 * click taps and a press holds.
 */
export function KeysBar({ store, actions }: { store: Store<AppState>; actions: KeysBarActions }) {
  const c = useStore(store, (s) => s.world?.controlled);
  const e = useStore(store, (s) => s.world?.energy);
  const unlimited = useStore(store, (s) => s.world?.unlimitedEnergy ?? false);
  const keys = c?.keys ?? [];
  const scriptKeys = c?.scriptKeys ?? [];
  if (keys.length === 0 && scriptKeys.length === 0 && !e) return null;
  const name = c?.name ?? e?.name ?? '';
  const press = (key: string) => ({
    onPointerDown: (ev: PointerEvent) => {
      ev.preventDefault();
      actions.robotKeyDown(key);
      // Keep the key held if the pointer slides off the button; it lets go on release anywhere.
      try {
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      } catch {
        // A pointer that is not active (synthetic events) cannot be captured; pointerup still releases.
      }
    },
    onPointerUp: () => actions.robotKeyUp(key),
    onPointerCancel: () => actions.robotKeyUp(key),
    onLostPointerCapture: () => actions.robotKeyUp(key),
  });
  const pct = e?.percent ?? 0;
  return (
    <div class="keys-bar plate" title={c ? `${name}'s energy and keys. Click a key to tap it, press to hold it.` : `${name}'s energy. You only watch it: it cannot be driven from here.`}>
      {e && (
        <div class="energy" title={unlimited ? 'unlimited energy is on' : `${pct}% of ${e.capacity} energy`}>
          <span class="h">Energy</span>
          <div class="energy-track">
            <div class={`energy-fill${pct < 15 ? ' low' : ''}${unlimited ? ' unlimited' : ''}`} style={{ width: `${unlimited ? 100 : pct}%` }} />
          </div>
          <span class="energy-text">{unlimited ? 'no limit' : e.capacity === 0 ? 'none' : `${pct}%`}</span>
        </div>
      )}
      {keys.map((k) => (
        <button key={k.key} tabIndex={-1} class={`robot-key${k.held ? ' held' : ''}`} {...press(k.key)}>
          {label(k.key)}
          {k.toggle && <span class={k.on ? 'toggle-dot on' : 'toggle-dot'} />}
        </button>
      ))}
      {scriptKeys.length > 0 && <span class="keys-divider" title="keys its running scripts read" />}
      {scriptKeys.map((k) => (
        <button key={`script-${k.key}`} tabIndex={-1} class={`robot-key script-key${k.held ? ' held' : ''}`} title="read by a running script" {...press(k.key)}>
          {label(k.key)}
        </button>
      ))}
    </div>
  );
}
