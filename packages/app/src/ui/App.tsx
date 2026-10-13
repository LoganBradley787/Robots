import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Dialog } from './Dialog';
import type { BuilderActions, PartActions } from './actions';
import { BuilderScreen } from './BuilderScreen';
import type { BindingActions } from './BindingsPanel';
import { WorldToolbar, type WorldActions } from './WorldToolbar';
import { KeysBar, type KeysBarActions } from './KeysBar';
import type { ScriptActions } from './ScriptsPanel';
import { Readout, type ReadoutActions } from './Readout';
import type { ScriptEditorActions } from './ScriptEditor';

export type AppActions = BuilderActions & PartActions & BindingActions & WorldActions & KeysBarActions & ScriptActions & ScriptEditorActions & ReadoutActions;

export function App({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const mode = useStore(store, (s) => s.mode);
  const dialog = useStore(store, (s) => s.dialog);
  const notice = useStore(store, (s) => s.notice);
  return (
    <>
      {mode === 'builder' ? (
        <BuilderScreen store={store} registry={registry} actions={actions} />
      ) : (
        <>
          <Readout store={store} actions={actions} />
          <KeysBar store={store} actions={actions} />
          <WorldToolbar store={store} actions={actions} />
        </>
      )}
      {notice && <div class="notice plate">{notice}</div>}
      {dialog && <Dialog dialog={dialog} />}
    </>
  );
}
