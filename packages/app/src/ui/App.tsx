import type { PartDef, PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Dialog } from './Dialog';
import { BuilderHelp, IssuesPanel, Palette, StatsBadge, TopBar, type BuilderActions } from './BuilderUi';
import { SelectionPanel, type SelectionActions } from './SelectionPanel';
import { BindingsPanel, type BindingActions } from './BindingsPanel';
import { WorldToolbar, type WorldActions } from './WorldToolbar';

export type AppActions = BuilderActions & SelectionActions & BindingActions & WorldActions;

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
            <SelectionPanel store={store} defs={defs} actions={actions} />
            <BindingsPanel store={store} registry={registry} actions={actions} />
            <IssuesPanel store={store} actions={actions} />
          </div>
          <StatsBadge store={store} />
          <BuilderHelp />
        </>
      ) : (
        <WorldToolbar store={store} actions={actions} />
      )}
      {notice && <div class="notice panel">{notice}</div>}
      {dialog && <Dialog dialog={dialog} />}
    </>
  );
}
