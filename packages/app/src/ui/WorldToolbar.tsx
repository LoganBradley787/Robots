import { useState } from 'preact/hooks';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { teamName } from '../world/deploySettings';

export interface WorldActions {
  worldTogglePause(): void;
  worldStep(): void;
  worldSlower(): void;
  worldFaster(): void;
  worldCamera(): void;
  worldHome(): void;
  worldToggleDebug(): void;
  worldToggleGrid(): void;
  worldReset(): void;
  clearDebris(): void;
  saveReplay(): void;
  toggleUnlimitedEnergy(): void;
  toggleDeployTeam(): void;
  /** M9: drops `n` hovering drones, or `n` enemy drones a side for a battle, around the middle of the screen. */
  stress(kind: 'hover' | 'battle', n: number): void;
  toBuilder(): void;
}

/** Every world control as a button, with its key. Reset is only here, and it asks first. */
export function WorldToolbar({ store, actions }: { store: Store<AppState>; actions: WorldActions }) {
  const v = useStore(store, (s) => s.world);
  const [stressOpen, setStressOpen] = useState(false);
  if (!v) return null;
  const stress = (kind: 'hover' | 'battle', n: number): void => {
    setStressOpen(false);
    actions.stress(kind, n);
  };
  return (
    <div class="world-toolbar panel">
      <button onClick={actions.toBuilder} title="Tab">
        Builder <kbd>Tab</kbd>
      </button>
      <span class="sep" />
      <button onClick={actions.worldTogglePause}>
        {v.paused ? 'Play' : 'Pause'} <kbd>Space</kbd>
      </button>
      <button onClick={actions.worldStep}>
        Step <kbd>.</kbd>
      </button>
      <button onClick={actions.worldSlower} aria-label="slower">
        <kbd>[</kbd>
      </button>
      <span class="speed">x{v.timeScale}</span>
      <button onClick={actions.worldFaster} aria-label="faster">
        <kbd>]</kbd>
      </button>
      <span class="sep" />
      <button onClick={actions.worldCamera} disabled={v.robots === 0} title={v.follow ? 'next robot' : 'follow again'}>
        {v.follow ? 'Next robot' : 'Follow'} <kbd>,</kbd>
      </button>
      <button onClick={actions.worldHome} title="Camera back to the drop point">
        Home
      </button>
      <button class={v.debug ? 'on' : ''} onClick={actions.worldToggleDebug}>
        Debug <kbd>\</kbd>
      </button>
      <button class={v.grid ? 'on' : ''} onClick={actions.worldToggleGrid}>
        Grid <kbd>`</kbd>
      </button>
      <span class="sep" />
      <button class={v.deployTeam !== 0 ? 'on enemy' : ''} onClick={actions.toggleDeployTeam} title="Which side the next robot you deploy joins. You only control your own; enemies run their scripts. While placing, F flips and R turns.">
        Deploy as: {teamName(v.deployTeam)}
      </button>
      <button class={v.unlimitedEnergy ? 'on' : ''} onClick={actions.toggleUnlimitedEnergy} title="Sandbox: every part gets all the energy it asks for, and nothing drains">
        Unlimited energy
      </button>
      <button onClick={actions.saveReplay} disabled={v.robots === 0} title="Save this run to replays/ so the headless runner can rerun it exactly">
        Save replay
      </button>
      <span class="stress">
        <button class={stressOpen ? 'on' : ''} onClick={() => setStressOpen(!stressOpen)} title="Drop a crowd of scripted robots to see how the sim copes. Turn on Debug for the numbers, and Unlimited energy so the drones do not run dry and fall">
          Stress
        </button>
        {stressOpen && (
          <div class="stress-menu panel">
            <div class="stress-row">
              Hover:
              {[10, 25, 50, 100].map((n) => (
                <button key={n} onClick={() => stress('hover', n)}>
                  {n}
                </button>
              ))}
            </div>
            <div class="stress-row">
              Battle:
              <button onClick={() => stress('battle', 6)}>6 vs 6</button>
            </div>
          </div>
        )}
      </span>
      <button onClick={actions.clearDebris} disabled={v.robots === 0} title="Remove every robot nobody can control: debris, robots that lost their core, bombs">
        Clear debris
      </button>
      <button class="danger" onClick={actions.worldReset} disabled={v.robots === 0}>
        Clear robots
      </button>
    </div>
  );
}
