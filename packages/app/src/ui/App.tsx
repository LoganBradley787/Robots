import type { PartDef, PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Dialog } from './Dialog';
import { BuilderHelp, IssuesPanel, Palette, StatsBadge, TopBar, type BuilderActions } from './BuilderUi';
import { PartMenu, type PartMenuActions } from './PartMenu';
import { BindingsPanel, type BindingActions } from './BindingsPanel';
import { WorldToolbar, type WorldActions } from './WorldToolbar';
import { KeysBar, type KeysBarActions } from './KeysBar';

export type AppActions = BuilderActions & PartMenuActions & BindingActions & WorldActions & KeysBarActions;

export function App({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const defs: PartDef[] = registry.list();
  const mode = useStore(store, (s) => s.mode);
  const dialog = useStore(store, (s) => s.dialog);
  const notice = useStore(store, (s) => s.notice);
  return (
    <>
      {mode === 'builder' ? (
        <>
          <TopBar store={store} actions={actions} />
          <Palette store={store} defs={defs} actions={actions} />
          <div class="side panel">
            <BindingsPanel store={store} registry={registry} actions={actions} />
            <IssuesPanel store={store} actions={actions} />
          </div>
          <PartMenu store={store} registry={registry} actions={actions} />
          <StatsBadge store={store} />
          <BuilderHelp />
        </>
      ) : (
        <>
          <KeysBar store={store} actions={actions} />
          <WorldToolbar store={store} actions={actions} />
        </>
      )}
      {notice && <div class="notice panel">{notice}</div>}
      {dialog && <Dialog dialog={dialog} />}
    </>
  );
}
