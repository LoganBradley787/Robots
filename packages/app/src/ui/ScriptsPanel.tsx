import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { ControlsFor } from './ControlsFor';
import type { BuilderActions } from './actions';
import { Button, Check } from './kit';

export interface ScriptActions {
  addScript(): void;
  removeScript(id: string): void;
  renameScript(from: string, to: string): void;
  setScriptEnabled(id: string, on: boolean): void;
  openScript(id: string): void;
}

/** The robot's scripts (M5): each one's name, whether it starts on deploy, and a button to edit its code. */
export function ScriptsPanel({ store, actions }: { store: Store<AppState>; actions: ScriptActions & Pick<BuilderActions, 'setControlsFor'> }) {
  // M7: the picked core's scripts (the same pick as the Keys tab).
  const scripts = useStore(store, (s) => s.builder.controls.scripts);
  const main = useStore(store, (s) => s.builder.controls.core === undefined);
  const open = useStore(store, (s) => s.scriptEditor);
  return (
    <div class="sec">
      <div class="h">
        On this robot <span>plain .js files</span>
      </div>
      <ControlsFor store={store} actions={actions} />
      {scripts.length === 0 && <p class="dim small">Scripts are JavaScript that runs every tick with exact sensor data. They are saved as .js files next to the robot.</p>}
      {scripts.map((s) => (
        <div class="script-row" key={s.id}>
          <input
            class="field mono"
            value={s.id}
            title="the name a key switches on and off"
            aria-label="script name"
            onChange={(e) => actions.renameScript(s.id, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
          <button type="button" class="x" aria-label={`remove script ${s.id}`} title="Remove" onClick={() => actions.removeScript(s.id)}>
            &#10005;
          </button>
          <div class="wide">
            <Check checked={s.enabled} onChange={(on) => actions.setScriptEnabled(s.id, on)} title={main ? 'runs as soon as the robot is in the world' : "runs as soon as this core's piece breaks off"}>
              {main ? 'on at start' : 'on at release'}
            </Check>
            <Button small on={open === s.id} onClick={() => actions.openScript(s.id)}>
              Edit code
            </Button>
          </div>
          {s.file !== undefined && <div class="script-file">{s.file}</div>}
        </div>
      ))}
      <Button onClick={actions.addScript}>Add a script</Button>
    </div>
  );
}
