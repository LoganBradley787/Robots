import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Sprite } from './kit';
import { EditNote } from './BoardNotes';

/** What is in the hand, in a few words: the hand chip and the hint line say the same thing. */
export function handText(b: Pick<AppState['builder'], 'held' | 'copy' | 'stamp' | 'eraser'>, registry: PartRegistry): string | undefined {
  const name = (type: string): string => (registry.has(type) ? registry.get(type).name : type);
  if (b.stamp) return b.stamp.name;
  if (b.eraser) return 'Eraser';
  if (b.copy) {
    const types = b.copy.types;
    const one = types.length === 1 && types[0] !== undefined ? types[0] : undefined;
    return one !== undefined ? `Copy of ${name(one)}` : `Copy of ${types.length} parts`;
  }
  if (b.held) return name(b.held.part);
  return undefined;
}

/**
 * On the board's top left (M16): the hand chip (what you hold; a click or Esc puts it down), the Mirror switch, and
 * while a script's reach is lit, what the light means. Under them, what the last edit affected.
 */
export function BoardChips({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BuilderActions }) {
  const held = useStore(store, (s) => s.builder.held);
  const copy = useStore(store, (s) => s.builder.copy);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const mirror = useStore(store, (s) => s.builder.mirror);
  const shown = useStore(store, (s) => s.builder.shown);
  const icons = useStore(store, (s) => s.icons);
  const text = handText({ ...(held ? { held } : {}), ...(copy ? { copy } : {}), ...(stamp ? { stamp } : {}), eraser }, registry);
  const full = text !== undefined;
  const turned = stamp ?? copy;
  const copyOf = copy?.types.length === 1 ? copy.types[0] : undefined;
  return (
    <>
      <div class="chips">
        <button type="button" class={`chipb plate${full ? ' on' : ''}`} disabled={!full} onClick={actions.putDown} title={full ? 'Click, right-click the board, or press Esc to put it down' : 'Nothing in hand: a click selects, a drag moves or draws a box'}>
          {full ? (
            <>
              {eraser && (
                <span class="eraser-x" style={{ width: '18px', height: '18px', fontSize: '13px' }}>
                  &#10005;
                </span>
              )}
              {held && <Sprite src={icons[held.part]} size={18} rot={held.rot} />}
              {copyOf !== undefined && <Sprite src={icons[copyOf]} size={18} />}
              <span>
                <b>{text}</b> in hand
                {turned && turned.rot !== 0 ? `, turned ${turned.rot}` : ''}
                {turned?.flipped ? ', flipped' : ''}
                {copy && copy.groups.length > 0 ? `, in ${copy.groups.length === 1 ? 'group' : 'groups'} ${copy.groups.slice(0, 3).join(', ')}${copy.groups.length > 3 ? ` and ${copy.groups.length - 3} more` : ''}` : ''}
                {held ? ', blank' : ''}
              </span>
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
          title={mirror.on ? `Mirror is on: what you place, swap, move or erase happens on both sides of the line at x ${(mirror.axisHalfCells / 2).toFixed(1)}, or not at all` : 'Mirror: what you place, swap, move or erase happens on both sides of a line'}
        >
          <span class={`switch${mirror.on ? ' on' : ''}`}>
            <span class="track" />
          </span>
          <span>Mirror</span>
          <kbd>M</kbd>
        </button>
        {shown && (
          <button type="button" class="chipb plate lit" onClick={() => actions.showScript(undefined)} title="The board shows what this script drives. Click, or press Esc with an empty hand, to put the light out.">
            <span>
              Lit: what <b>{shown.id}.js</b> drives
            </span>
            <span class="key-reach">
              <i class="sw solid" />
              {shown.reached.length}
            </span>
            {shown.fits.length > 0 && (
              <span class="key-reach" title="They fit a name the script builds in its own code">
                <i class="sw dashed" />
                {shown.fits.length} likely
              </span>
            )}
            {shown.undriven.length > 0 && (
              <span class="key-reach" title="They look like they belong, and the script does not reach them">
                <i class="sw undriven" />
                {shown.undriven.length} not driven
              </span>
            )}
            <span class="xx">&#10005;</span>
          </button>
        )}
      </div>
      <EditNote store={store} actions={actions} />
    </>
  );
}
