import { useEffect } from 'preact/hooks';
import type { PartRegistry } from '@robots/sim-core';
import { isTypingTarget } from '../app/keys';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { AppActions } from './App';
import { TopStrip } from './TopStrip';
import { Drawer } from './Drawer';
import { Inspector } from './Inspector';
import { BoardChips } from './BoardChips';
import { HelpCard, HintLine } from './HintLine';
import { PartMenu } from './PartMenu';
import { ScriptEditor } from './ScriptEditor';
import { Hotbar } from './Hotbar';
import { Library } from './Library';

/**
 * The builder's panels (M16), laid out as a grid over the canvas: a strip across the top, the parts drawer at the
 * left, the inspector at the right, a hint line along the bottom, and the board showing through the middle.
 */
export function BuilderScreen({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const overlay = useStore(store, (s) => s.panel.overlay);
  const dialog = useStore(store, (s) => s.dialog !== undefined);
  // `?` opens the key list from anywhere on the builder; Esc closes whatever is over the board.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (dialog || e.metaKey || e.ctrlKey || e.altKey) return;
      // A menu open over the library closes first (it listens for Esc itself).
      if (e.key === 'Escape' && overlay !== undefined && !document.querySelector('.pop')) {
        e.stopPropagation();
        store.set((s) => ({ panel: { ...s.panel, overlay: undefined } }));
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        store.set((s) => ({ panel: { ...s.panel, overlay: s.panel.overlay === 'help' ? undefined : 'help' } }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlay, dialog]);
  return (
    <div class="builder">
      <TopStrip store={store} actions={actions} />
      <Drawer store={store} registry={registry} actions={actions} />
      <div class="board">
        <BoardChips store={store} registry={registry} actions={actions} />
        <Hotbar store={store} registry={registry} actions={actions} />
      </div>
      <Inspector store={store} registry={registry} actions={actions} />
      <HintLine store={store} registry={registry} />
      <HelpCard store={store} />
      <PartMenu store={store} registry={registry} actions={actions} />
      <ScriptEditorHost store={store} actions={actions} />
      {overlay === 'library' && <Library store={store} actions={actions} />}
    </div>
  );
}

/** Remounts the editor per script, so a check or params from the last script never show on the next. */
function ScriptEditorHost({ store, actions }: { store: Store<AppState>; actions: AppActions }) {
  const id = useStore(store, (s) => s.scriptEditor);
  return id ? <ScriptEditor key={id} store={store} actions={actions} /> : null;
}
