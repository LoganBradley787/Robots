import { worldKeyCap } from '../app/keys';
import { TIME_SCALES } from '../app/TimeControls';
import { speedText } from '../app/Hud';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { WorldActions } from './WorldToolbar';
import { Button } from './kit';

/** How each speed reads under its arrow. */
const ARROW_LABEL = (scale: number): string => (scale >= 1 ? String(scale) : `1/${Math.round(1 / scale)}`);

/**
 * The time panel at the top left of the world (M16, after Kerbal Space Program's): the clock, PAUSED, the speed when
 * it is not 1x, and who you control or watch, always. Hovering it (or the keyboard's focus) drops it down to play or
 * pause, Step, and a row of arrows, one per speed, lit up to the one it runs at; a click on an arrow goes straight to
 * that speed. The world keys (Space, `.`, `[`, `]`) work as before.
 */
export function TimePanel({ store, actions }: { store: Store<AppState>; actions: Pick<WorldActions, 'worldTogglePause' | 'worldStep' | 'worldSetSpeed'> }) {
  const v = useStore(store, (s) => s.world);
  const clock = useStore(store, (s) => s.clock ?? '0:00.0');
  if (!v) return null;
  const at = TIME_SCALES.findIndex((s) => s === v.timeScale);
  // A click must not leave the focus on a button: the panel would stay open, and Space would press the button too.
  const noFocus = (e: MouseEvent): void => e.preventDefault();
  return (
    <div class={`time-panel plate${v.paused ? ' paused' : ''}`} tabIndex={0} role="group" aria-label={`Time ${clock}${v.paused ? ', paused' : ''}, speed ${speedText(v.timeScale)}`} onContextMenu={(e) => e.preventDefault()}>
      <div class="tp-line">
        <span class="tp-clock">{clock}</span>
        {v.paused && <span class="tp-paused h">Paused</span>}
        {v.timeScale !== 1 && <span class="tp-speed">{speedText(v.timeScale)}</span>}
      </div>
      <div class="tp-who" title={v.who}>
        {v.who}
      </div>
      <div class="tp-drop" onMouseDown={noFocus}>
        <div class="tp-row">
          <Button class="pp" kind={v.paused ? 'go' : undefined} onClick={actions.worldTogglePause} title={v.paused ? 'Play (Space)' : 'Pause (Space)'}>
            {v.paused ? 'Play' : 'Pause'} <kbd>{worldKeyCap('togglePause')}</kbd>
          </Button>
          <Button onClick={actions.worldStep} title="One tick forward, then paused (.)">
            Step <kbd>{worldKeyCap('step')}</kbd>
          </Button>
        </div>
        <div class="tp-warp" role="group" aria-label="Speed">
          {TIME_SCALES.map((scale, i) => (
            <button
              type="button"
              key={scale}
              class={`warp${i <= at ? ' lit' : ''}${i === at ? ' at' : ''}`}
              aria-label={`speed ${speedText(scale)}`}
              aria-pressed={i === at}
              title={`${speedText(scale)} speed`}
              onClick={() => actions.worldSetSpeed(i)}
            >
              <i />
              <span>{ARROW_LABEL(scale)}</span>
            </button>
          ))}
        </div>
        <div class="tp-keys">
          <kbd>{worldKeyCap('slower')}</kbd> slower <kbd>{worldKeyCap('faster')}</kbd> faster
        </div>
      </div>
    </div>
  );
}
