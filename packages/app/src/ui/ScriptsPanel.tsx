import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { ControlsFor } from './ControlsFor';
import type { BuilderActions, PartActions } from './actions';
import { Button, Check } from './kit';
import { showScript, type ScriptShow } from '../builder/scriptView';
import { typeName } from '../builder/boardOps';

export interface ScriptActions {
  addScript(): void;
  removeScript(id: string): void;
  renameScript(from: string, to: string): void;
  setScriptEnabled(id: string, on: boolean): void;
  openScript(id: string): void;
}

type Actions = ScriptActions & Pick<BuilderActions, 'setControlsFor' | 'showScript' | 'peekScript' | 'select'> & Pick<PartActions, 'addTag'>;

const parts = (n: number): string => `${n} part${n === 1 ? '' : 's'}`;

/** One line for what a script reaches: "Drives 12 parts", "Drives 4 parts, likely 24 more", "Reaches no part by a plain name". */
function reachText(v: ScriptShow): string {
  if (v.reached.length === 0 && v.fits.length === 0) return v.buildsTargets ? 'Picks its parts in its own code' : 'Reaches no part';
  if (v.reached.length === 0) return `Likely drives ${parts(v.fits.length)}`;
  return `Drives ${parts(v.reached.length)}${v.fits.length > 0 ? `, likely ${v.fits.length} more` : ''}`;
}

/**
 * The robot's scripts (M5), and for each what it drives (M16): hover a script, or switch its Show on, and the board
 * lights up every part it reaches. Parts that look like they belong and are not driven are listed with the fix.
 */
export function ScriptsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: Actions }) {
  // M7: the picked core's scripts (the same pick as the Keys tab).
  const scripts = useStore(store, (s) => s.builder.controls.scripts);
  const main = useStore(store, (s) => s.builder.controls.core === undefined);
  const core = useStore(store, (s) => s.builder.controlsFor);
  const draft = useStore(store, (s) => s.builder.draft);
  const open = useStore(store, (s) => s.scriptEditor);
  const pinned = useStore(store, (s) => s.builder.shownPinned);
  const [peek, setPeek] = useState<string | undefined>(undefined);
  // Leaving the tab with the mouse still on a row must not leave the board lit.
  useEffect(() => () => actions.peekScript(undefined), []);
  const views = useMemo(() => new Map(scripts.map((s) => [s.id, showScript(draft, registry, core, s.id)])), [draft, core, scripts]);
  const look = (id: string | undefined): void => {
    if (id === peek) return;
    setPeek(id);
    actions.peekScript(id);
  };
  return (
    <div class="sec">
      <div class="h">
        On this robot <span>plain .js files</span>
      </div>
      <ControlsFor store={store} actions={actions} />
      {scripts.length === 0 && <p class="dim small">Scripts are JavaScript that runs every tick with exact sensor data. They are saved as .js files next to the robot.</p>}
      {scripts.map((s) => {
        const v = views.get(s.id);
        const lit = pinned === s.id;
        return (
          <div class={`script-row${lit ? ' lit' : ''}`} key={s.id} onMouseEnter={() => look(s.id)} onMouseLeave={() => look(undefined)}>
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
            {v && (
              <div class="wide reach">
                <span>
                  <i class="sw solid" />
                  {reachText(v)}
                  {v.undriven.length > 0 && <b class="warn-text">, {v.undriven.length} not driven</b>}
                </span>
                <Button small on={lit} onClick={() => actions.showScript(lit ? undefined : s.id)} title={lit ? 'Put the light out (or press Esc)' : 'Keep the board lit with what this script drives'}>
                  {lit ? 'Lit' : 'Show'}
                </Button>
              </div>
            )}
            {v && lit && <ReachDetails v={v} registry={registry} draft={draft} actions={actions} />}
            {v && !lit && v.undriven.length > 0 && <Undriven v={v} registry={registry} draft={draft} actions={actions} />}
          </div>
        );
      })}
      <Button onClick={actions.addScript}>Add a script</Button>
    </div>
  );
}

/** The names a script uses and how many parts answer to each, and whether the list can be trusted to be all of it. */
function ReachDetails({ v, registry, draft, actions }: { v: ScriptShow; registry: PartRegistry; draft: AppState['builder']['draft']; actions: Actions }) {
  return (
    <div class="wide reach-more">
      {v.names.length > 0 && (
        <div class="names">
          {v.names.map((n) => (
            <span key={n.name} class={`name-chip${n.dead ? ' dead' : n.spare ? ' spare' : ''}`} title={n.dead ? 'No part answers to this name: see Problems' : n.spare ? 'A part type this robot does not have. The script drives another kind too, so it is not a problem.' : `${parts(n.parts)} answer to this name`}>
              {n.name}
              <b>{n.dead ? 'nothing' : n.spare ? 'spare' : n.parts}</b>
            </span>
          ))}
        </div>
      )}
      {v.buildsTargets && (
        <p class="honest">
          This script also picks parts in its own code, so this list may be incomplete.
          {v.fits.length > 0 ? ` The ${parts(v.fits.length)} with a dashed frame fit a name it builds.` : ''}
        </p>
      )}
      {!v.buildsTargets && v.names.length === 0 && <p class="honest">It names no part: it only reads, or does nothing yet.</p>}
      <Undriven v={v} registry={registry} draft={draft} actions={actions} />
    </div>
  );
}

/** Parts that look like they belong to a script and are not driven by it, each with the one click that fixes it. */
function Undriven({ v, registry, draft, actions }: { v: ScriptShow; registry: PartRegistry; draft: AppState['builder']['draft']; actions: Actions }) {
  if (v.undriven.length === 0) return null;
  // The same fix for all of them, when they share one.
  const first = v.undriven[0]?.groups[0];
  const all = first && v.undriven.length > 1 && v.undriven.every((u) => u.groups[0]?.tag === first.tag) ? first : undefined;
  return (
    <div class="wide undriven">
      <div class="uh">
        <i class="sw undriven" />
        Not driven
        <span class="dim">of a kind this script drives, in none of its groups</span>
      </div>
      {v.undriven.map((u) => {
        const p = draft.parts.find((x) => x.id === u.part);
        return (
          <div class="urow" key={u.part}>
            <button type="button" class="linkish" title="Select it on the board" onClick={() => actions.select([u.part])}>
              {typeName(registry, u.type)} at {p?.x ?? '?'}, {p?.y ?? '?'}
            </button>
            {u.groups.slice(0, 2).map((g) => (
              <Button small key={g.tag} onClick={() => actions.addTag([u.part], g.tag)} title={`The script writes ${u.inputs.join(', ')} on the group "${g.name}". Adding this part to it is one undo step.`}>
                Add to group {g.name}
              </Button>
            ))}
          </div>
        );
      })}
      {all && (
        <Button small onClick={() => actions.addTag(v.undriven.map((u) => u.part), all.tag)}>
          Add all {v.undriven.length} to group {all.name}
        </Button>
      )}
    </div>
  );
}
