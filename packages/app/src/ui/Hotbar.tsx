import { useState } from 'preact/hooks';
import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { DRAG_PART } from './Drawer';
import { Sprite } from './kit';

const DRAG_SLOT = 'application/x-robots-slot';

/**
 * The hotbar (M16), at the bottom of the board: nine slots on the keys 1 to 9, then the eraser on E. Drag a tile
 * from the drawer onto a slot to set it; drag a slot onto another to swap them. It never changes by itself.
 */
export function Hotbar({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BuilderActions }) {
  const hotbar = useStore(store, (s) => s.hotbar);
  const held = useStore(store, (s) => s.builder.held?.part);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const icons = useStore(store, (s) => s.icons);
  const [over, setOver] = useState<number | undefined>(undefined);
  const takes = (e: DragEvent): boolean => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes(DRAG_PART) || types.includes(DRAG_SLOT);
  };
  return (
    <div class="hotbar plate" onDragLeave={() => setOver(undefined)}>
      {hotbar.map((part, i) => {
        const def = part !== null && registry.has(part) ? registry.get(part) : undefined;
        return (
          <button
            type="button"
            key={i}
            class={`slot${def && held === def.id ? ' on' : ''}${over === i ? ' over' : ''}`}
            title={def ? `${def.name} (${i + 1}). Drag another part here to change it.` : `Empty (${i + 1}). Drag a part here from the drawer.`}
            aria-label={def ? `${def.name}, key ${i + 1}` : `empty slot, key ${i + 1}`}
            draggable={def !== undefined}
            onClick={() => def && actions.hold(def.id)}
            onDragStart={(e) => {
              e.dataTransfer?.setData(DRAG_SLOT, String(i));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!takes(e)) return;
              e.preventDefault();
              if (over !== i) setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(undefined);
              const dropped = e.dataTransfer?.getData(DRAG_PART) ?? '';
              const from = e.dataTransfer?.getData(DRAG_SLOT) ?? '';
              if (dropped !== '' && registry.has(dropped)) actions.setHotbarSlot(i, dropped);
              else if (from !== '') actions.swapHotbarSlots(Number(from), i);
            }}
          >
            <span class="key">{i + 1}</span>
            {def && <Sprite src={icons[def.id]} size={32} />}
          </button>
        );
      })}
      <span class="sep" />
      <button type="button" class={`slot${eraser ? ' on' : ''}`} title="Eraser (E): click or drag over parts to remove them" aria-label="eraser, key E" onClick={actions.eraser}>
        <span class="key">E</span>
        <span class="eraser-x" style={{ width: '32px', height: '32px', fontSize: '18px' }}>
          &#10005;
        </span>
      </button>
    </div>
  );
}
