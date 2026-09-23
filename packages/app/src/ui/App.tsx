import type { PartDef } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Dialog } from './Dialog';
import { BuilderHelp, IssuesPanel, Palette, StatsBadge, TopBar, type BuilderActions } from './BuilderUi';

export function App({ store, defs, actions }: { store: Store<AppState>; defs: PartDef[]; actions: BuilderActions }) {
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
            <IssuesPanel store={store} actions={actions} />
          </div>
          <StatsBadge store={store} />
          <BuilderHelp />
        </>
      ) : (
        <div class="mode-badge">World (Tab: builder)</div>
      )}
      {notice && <div class="notice panel">{notice}</div>}
      {dialog && <Dialog dialog={dialog} />}
    </>
  );
}
