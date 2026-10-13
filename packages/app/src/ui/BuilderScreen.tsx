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
import { ScriptEditor } from './ScriptEditor';
import { Hotbar } from './Hotbar';
import { Library } from './Library';
import { CursorNoteView } from './BoardNotes';
import { FillBanner } from './FillBanner';
import { UpdateWindow } from './UpdateWindow';

/**
 * The builder's panels (M16), laid out as a grid over the canvas: a strip across the top, the parts drawer at the
 * left, the inspector at the right, a hint line along the bottom, and the board showing through the middle.
 */
export function BuilderScreen({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const overlay = useStore(store, (s) => s.panel.overlay);
  const dialog = useStore(store, (s) => s.dialog !== undefined);
  const scriptOpen = useStore(store, (s) => s.scriptEditor !== undefined);
  const update = useStore(store, (s) => s.behaviorUpdate !== undefined);
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
      // What a behavior's update would change is over the board too.
      if (e.key === 'Escape' && update) {
        e.stopPropagation();
        actions.showBehaviorUpdate(undefined);
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
  }, [overlay, dialog, update]);
  return (
    <div class={`builder${scriptOpen ? ' with-script' : ''}`}>
      <TopStrip store={store} actions={actions} />
      <Drawer store={store} registry={registry} actions={actions} />
      <div class="board">
        <BoardChips store={store} registry={registry} actions={actions} />
        <FillBanner store={store} actions={actions} />
        <Hotbar store={store} registry={registry} actions={actions} />
      </div>
      <Inspector store={store} registry={registry} actions={actions} />
      <HintLine store={store} registry={registry} />
      <HelpCard store={store} />
      <ScriptEditorHost store={store} registry={registry} actions={actions} />
      <UpdateWindow store={store} actions={actions} />
      {overlay === 'library' && <Library store={store} actions={actions} />}
      <CursorNoteView store={store} actions={actions} />
    </div>
  );
}

/** Remounts the editor per script, so a check or params from the last script never show on the next. */
function ScriptEditorHost({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const id = useStore(store, (s) => s.scriptEditor);
  const core = useStore(store, (s) => s.builder.controlsFor);
  return id ? <ScriptEditor key={`${core ?? ''}/${id}`} store={store} registry={registry} actions={actions} /> : null;
}
