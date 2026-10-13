import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Sprite } from './kit';

/**
 * On the board's top left (M16): the hand chip (what you hold; a click or Esc puts it down) and the Mirror switch.
 * Under them, for a moment, why the last click was refused.
 */
export function BoardChips({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BuilderActions }) {
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const mirror = useStore(store, (s) => s.builder.mirror);
  const refused = useStore(store, (s) => s.builder.refused);
  const icons = useStore(store, (s) => s.icons);
  const full = held !== undefined || eraser || stamp !== undefined;
  return (
    <>
      <div class="chips">
        <button type="button" class={`chipb plate${full ? ' on' : ''}`} disabled={!full} onClick={actions.putDown} title={full ? 'Click or press Esc to put it down' : 'Nothing in hand: clicks select'}>
          {stamp ? (
            <>
              <span>
                <b>{stamp.name}</b> in hand{stamp.rot !== 0 ? `, turned ${stamp.rot}` : ''}
                {stamp.flipped ? ', flipped' : ''}
              </span>
              <kbd>Esc</kbd>
            </>
          ) : eraser ? (
            <>
              <span class="eraser-x" style={{ width: '18px', height: '18px', fontSize: '13px' }}>
                &#10005;
              </span>
              <span>Eraser in hand</span>
              <kbd>Esc</kbd>
            </>
          ) : held ? (
            <>
              <Sprite src={icons[held.part]} size={18} rot={held.rot} />
              <span>{registry.has(held.part) ? registry.get(held.part).name : held.part} in hand</span>
              <kbd>Esc</kbd>
            </>
          ) : (
            'Empty hand'
          )}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={mirror.on}
          class={`chipb plate${mirror.on ? ' on' : ''}`}
          onClick={actions.toggleMirror}
          title={mirror.on ? `Mirror is on: what you place lands on both sides of the line at x ${(mirror.axisHalfCells / 2).toFixed(1)}` : 'Mirror: what you place lands on both sides of a line'}
        >
          <span class={`switch${mirror.on ? ' on' : ''}`}>
            <span class="track" />
          </span>
          <span>Mirror</span>
          <kbd>M</kbd>
        </button>
      </div>
      {refused !== undefined && <div class="toast plate float">{refused}</div>}
    </>
  );
}
