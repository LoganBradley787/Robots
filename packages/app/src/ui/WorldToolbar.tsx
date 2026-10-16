import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { worldKeyCap } from '../app/keys';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { teamName } from '../world/deploySettings';
import { Button, Popover, Slider } from './kit';

export interface WorldActions {
  worldTogglePause(): void;
  worldStep(): void;
  /** Straight to one speed of `TIME_SCALES` (the time panel's arrows). */
  worldSetSpeed(index: number): void;
  worldCamera(): void;
  worldHome(): void;
  worldToggleDebug(): void;
  worldToggleGrid(): void;
  worldReset(): void;
  clearDebris(): void;
  saveReplay(): void;
  toggleUnlimitedEnergy(): void;
  toggleDeployTeam(): void;
  /** M15: sound off and on, its volume (0 to 1), and whether far sounds arrive late. */
  toggleMute(): void;
  setVolume(volume: number): void;
  toggleSoundDelay(): void;
  /** M9: drops `n` hovering drones, or `n` enemy drones a side for a battle, around the middle of the screen. */
  stress(kind: 'hover' | 'battle', n: number): void;
  toBuilder(): void;
}

const HOVER_COUNTS = [10, 25, 50, 100];

/**
 * The world bar (M16 step 7): a small bar in the middle of the bottom edge (back to the builder, and the team the next
 * robot joins) and two menus. View holds what changes how you see and hear the world; Sandbox holds what changes the
 * world. Every row says its state and its key, and every world key works as it always did: the menus are only another
 * way to press them. Play, Step and the speed are in the time panel at the top left (`TimePanel.tsx`).
 */
export function WorldToolbar({ store, actions }: { store: Store<AppState>; actions: WorldActions }) {
  const v = useStore(store, (s) => s.world);
  if (!v) return null;
  const none = v.robots === 0;
  const onOff = (on: boolean): string => (on ? 'on' : 'off');
  return (
    <div class="transport plate" onContextMenu={(e) => e.preventDefault()}>
      <Button onClick={actions.toBuilder} title="Back to the builder (Tab)">
        &#9664; Builder <kbd>Tab</kbd>
      </Button>
      <span class="sep" />
      <Button class={`team${v.deployTeam !== 0 ? ' enemy' : ''}`} onClick={actions.toggleDeployTeam} title="Which side the next robot you deploy joins: click to switch. You only control your own; enemies run their scripts.">
        <span class="lb">Team</span> {teamName(v.deployTeam)}
      </Button>
      <BarMenu label="View" title="Camera, grid, debug and sound">
        {() => (
          <>
            <Row
              label={v.follow ? 'Next robot' : 'Follow the robot'}
              state={none ? 'no robots' : v.follow ? 'following' : 'camera is free'}
              cap={worldKeyCap('camera')}
              disabled={none}
              onPick={actions.worldCamera}
              title={v.follow ? 'Moves the camera, and control, to the next robot of yours' : 'The camera goes back to the robot it was on'}
            />
            <Row label="Home" state="the drop point" onPick={actions.worldHome} title="Camera back to where robots drop in" />
            <Row label="Grid" state={onOff(v.grid)} on={v.grid} cap={worldKeyCap('toggleGrid')} onPick={actions.worldToggleGrid} />
            <Row label="Debug overlay" state={onOff(v.debug)} on={v.debug} cap={worldKeyCap('toggleDebug')} onPick={actions.worldToggleDebug} title="Physics outlines, what sensors see, and the tick, hash and timing text at the top left" />
            <div class="mi-sep" />
            <Row
              label="Sound"
              state={v.sound.muted ? 'off' : v.sound.awake ? 'on' : 'on at your next click'}
              on={!v.sound.muted}
              onPick={actions.toggleMute}
              title={v.sound.awake ? 'Sound on or off' : 'A browser lets sound start only after a click or a key press'}
            />
            <div class={`wrow slide${v.sound.muted ? ' off' : ''}`} title="Volume">
              <span class="lb">Volume</span>
              <Slider value={v.sound.volume} min={0} max={1} step={0.05} disabled={v.sound.muted} label="volume" onChange={actions.setVolume} />
              <span class="st">{Math.round(v.sound.volume * 100)}%</span>
            </div>
            <Row label="Far sounds arrive late" state={onOff(v.sound.delay)} on={v.sound.delay} onPick={actions.toggleSoundDelay} title="At the speed of sound: a blast 340 m away is heard a second after its flash" />
          </>
        )}
      </BarMenu>
      <BarMenu label="Sandbox" title="Energy, stress test, clearing up, replays" align="right">
        {(close) => (
          <>
            <Row label="Unlimited energy" state={onOff(v.unlimitedEnergy)} on={v.unlimitedEnergy} onPick={actions.toggleUnlimitedEnergy} title="Every part gets all the energy it asks for, and nothing drains" />
            <div class="mi-sep" />
            <div class="wblock" title="Drops a crowd of scripted robots around the middle of the screen, to see how the sim copes. Turn on Debug for the numbers, and Unlimited energy so the drones do not run dry and fall.">
              <div class="wb-head">Stress test</div>
              <div class="wb-line">
                <span class="lb">Hovering drones</span>
                {HOVER_COUNTS.map((n) => (
                  <Button
                    small
                    key={n}
                    onClick={() => {
                      close();
                      actions.stress('hover', n);
                    }}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <div class="wb-line">
                <span class="lb">A battle</span>
                <Button
                  small
                  onClick={() => {
                    close();
                    actions.stress('battle', 6);
                  }}
                >
                  6 against 6
                </Button>
              </div>
            </div>
            <div class="mi-sep" />
            <Row
              label="Clear debris"
              state=""
              disabled={none}
              onPick={() => {
                close();
                actions.clearDebris();
              }}
              title="Removes every robot nobody can control: debris, robots that lost their core, spent pieces"
            />
            <Row
              label="Save replay"
              state=""
              disabled={none}
              onPick={() => {
                close();
                actions.saveReplay();
              }}
              title="Saves this run to replays/ so the headless runner can rerun it exactly"
            />
            <Row
              label="Reset world"
              state={none ? 'empty' : `${v.robots} ${v.robots === 1 ? 'robot' : 'robots'}`}
              danger
              disabled={none}
              onPick={() => {
                close();
                actions.worldReset();
              }}
              title="Removes every robot from the world. It asks first. Your blueprints are not touched."
            />
          </>
        )}
      </BarMenu>
    </div>
  );
}

/** A bar button that opens a box of rows over it. Esc, a press anywhere else, or a resize closes it. Rows that only flip something leave it open, so the new state shows. */
function BarMenu({ label, title, align, children }: { label: string; title: string; align?: 'left' | 'right'; children(close: () => void): ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <Button on={open} onClick={() => setOpen(!open)} title={title}>
        {label} <span class="caret">{open ? '▾' : '▴'}</span>
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} class="wmenu" {...(align ? { align } : {})}>
          <div class="wm-head h">{label}</div>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </span>
  );
}

/** One menu row: what it is, its state now, and its key when it has one. */
function Row({ label, state, on, cap, onPick, disabled, danger, title }: { label: string; state: string; on?: boolean; cap?: string; onPick(): void; disabled?: boolean; danger?: boolean; title?: string }) {
  return (
    <button type="button" class={`mi wrow${danger ? ' danger' : ''}`} disabled={disabled} title={title} onClick={onPick} role={on !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={on}>
      <span class="lb">{label}</span>
      <span class={`st${on ? ' lit' : ''}`}>{state}</span>
      <span class="kc">{cap !== undefined && <kbd>{cap}</kbd>}</span>
    </button>
  );
}
