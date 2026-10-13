import type { PartDef } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Sprite } from './kit';

/** The left panel: every part as a tile, the eraser, and saved robots to place inside this one. */
export function Drawer({ store, defs, actions }: { store: Store<AppState>; defs: PartDef[]; actions: BuilderActions }) {
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const icons = useStore(store, (s) => s.icons);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const doc = useStore(store, (s) => s.doc);
  // Every saved robot except the one open (placing a robot on itself would be a copy of a copy).
  const saved = doc.files.filter((f) => f.file !== doc.file);
  return (
    <div class="drawer plate">
      <div class="scroll">
        <div class="cat h">Parts</div>
        <div class="tiles">
          {defs.map((d, i) => (
            <button type="button" key={d.id} class={`tile${held?.part === d.id ? ' on' : ''}`} onClick={() => actions.hold(d.id)}>
              {i < 9 && <span class="key">{i + 1}</span>}
              <Sprite src={icons[d.id]} size={40} />
              <span>{d.name}</span>
            </button>
          ))}
          <button type="button" class={`tile${eraser ? ' on' : ''}`} onClick={actions.eraser} title="Eraser (E): click or drag over parts to remove them">
            <span class="key">E</span>
            <span class="eraser-x" style={{ width: '40px', height: '40px' }}>
              &#10005;
            </span>
            <span>Eraser</span>
          </button>
        </div>
        {saved.length > 0 && <div class="cat h">Robots to place</div>}
        {saved.map((f) => (
          <button type="button" key={f.file} class={`asm${stamp?.name === f.name ? ' on' : ''}`} title="Place a copy inside this robot: R turns it, F flips it, Esc puts it down" onClick={() => actions.holdBlueprint(f.file)}>
            <span>{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
