import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState, InspectorTab } from './appState';
import type { AppActions } from './App';
import { BindingsPanel } from './BindingsPanel';
import { ScriptsPanel } from './ScriptsPanel';
import { Problems } from './Problems';
import { Tabs, type TabSpec } from './kit';
import { formatDuration } from './format';

/** The right panel: the robot's numbers, its keys, its scripts; Problems pinned under every tab. */
export function Inspector({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const want = useStore(store, (s) => s.panel.tab);
  const tabs: TabSpec<InspectorTab>[] = [
    { id: 'robot', label: 'Robot' },
    { id: 'keys', label: 'Keys' },
    { id: 'behaviors', label: 'Behaviors' },
  ];
  const tab = tabs.some((t) => t.id === want) ? want : 'robot';
  return (
    <div class="insp plate">
      <Tabs tabs={tabs} value={tab} onChange={actions.showTab} />
      <div class="scroll">
        {tab === 'robot' && <RobotTab store={store} />}
        {tab === 'keys' && <BindingsPanel store={store} registry={registry} actions={actions} />}
        {tab === 'behaviors' && <ScriptsPanel store={store} actions={actions} />}
      </div>
      <Problems store={store} actions={actions} />
    </div>
  );
}

function RobotTab({ store }: { store: Store<AppState> }) {
  const stats = useStore(store, (s) => s.builder.stats);
  return (
    <div class="sec">
      <div class="h">Robot</div>
      <div class="kv">
        <span>Parts</span>
        <b>{stats.parts}</b>
      </div>
      <div class="kv">
        <span>Mass</span>
        <b>{stats.massKg.toFixed(1)} kg</b>
      </div>
      <div class="kv">
        <span>Energy</span>
        <b>{stats.energy}</b>
      </div>
      <div class="kv" title="with every part working at full power">
        <span>Lasts at full power</span>
        <b>{stats.fullDraw > 0 ? formatDuration(stats.energy / stats.fullDraw) : 'does not run down'}</b>
      </div>
      {stats.massKg > 0 && (
        <div class="kv" title="center of mass, in cells">
          <span>Balance point</span>
          <b>
            {stats.comX.toFixed(2)}, {stats.comY.toFixed(2)}
          </b>
        </div>
      )}
    </div>
  );
}
