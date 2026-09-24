import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { ControlsFor, type BuilderActions } from './BuilderUi';

export interface ScriptActions {
  addScript(): void;
  removeScript(id: string): void;
  renameScript(from: string, to: string): void;
  setScriptEnabled(id: string, on: boolean): void;
  openScript(id: string): void;
}

/** The blueprint's scripts (M5): each one's name, whether it starts on deploy, and a button to edit its code. */
export function ScriptsPanel({ store, actions }: { store: Store<AppState>; actions: ScriptActions & Pick<BuilderActions, 'setControlsFor'> }) {
  // M7: the picked core's scripts (the same pick as the Controls panel).
  const scripts = useStore(store, (s) => s.builder.controls.scripts);
  const main = useStore(store, (s) => s.builder.controls.core === undefined);
  return (
    <section class="side-section">
      <h3>Scripts</h3>
      <ControlsFor store={store} actions={actions} />
      {scripts.length === 0 && <p class="muted small">Scripts are JavaScript that runs every tick with exact sensor data. They are saved as .js files next to the blueprint.</p>}
      {scripts.map((s) => (
        <div class="script-row" key={s.id}>
          <input
            class="script-id"
            value={s.id}
            title="the name a key binding toggles"
            onChange={(e) => actions.renameScript(s.id, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
          <label class="check inline" title={main ? 'runs as soon as the robot is deployed' : "runs as soon as this core's piece breaks off"}>
            <input type="checkbox" checked={s.enabled} onChange={(e) => actions.setScriptEnabled(s.id, (e.target as HTMLInputElement).checked)} />
            <span>{main ? 'on at deploy' : 'on at release'}</span>
          </label>
          <button onClick={() => actions.openScript(s.id)}>Edit</button>
          <button class="tag-remove" aria-label={`remove script ${s.id}`} onClick={() => actions.removeScript(s.id)}>
            ×
          </button>
          {s.file !== undefined && <div class="muted small script-file">{s.file}</div>}
        </div>
      ))}
      <button onClick={actions.addScript}>Add script</button>
    </section>
  );
}
