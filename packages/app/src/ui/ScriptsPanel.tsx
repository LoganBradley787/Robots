import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ParamSpec, PartRegistry } from '@robots/sim-core';
import { worldKeyLabel } from '../app/keys';
import { keyName } from '../builder/bindings';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { ControlsFor } from './ControlsFor';
import type { BuilderActions, PartActions } from './actions';
import type { ScriptCheck, ScriptEditorActions } from './ScriptEditor';
import { Button, Check, NumberField, Slider, Switch } from './kit';
import { num } from './format';
import { showScript, type ScriptShow } from '../builder/scriptView';
import { typeName } from '../builder/boardOps';
import { behaviorCards, isOnOff, shelfOffers, sliderRange, slotText, type BehaviorCard, type ParamInfo } from '../builder/shelf';

export interface ScriptActions {
  /** "Write your own": a blank script, opened in the script view. */
  addScript(): void;
  /** Asks first; for a behavior it also offers to clear the groups its slots filled. */
  removeScript(id: string): void;
  renameScript(from: string, to: string): void;
  setScriptEnabled(id: string, on: boolean): void;
  openScript(id: string): void;
  /** Reads the shelf of shared behaviors again (the list is opened). */
  loadShelf(): void;
  /** Starts adding a shelf behavior: its slots are filled on the board, one at a time. */
  addBehavior(shelfId: string): void;
  /** Reopens slot filling for one slot of a behavior on the robot. */
  changeSlot(scriptId: string, group: string): void;
  fillAccept(): void;
  /** Select all (true) or Clear (false) on the banner of a slot that takes many parts. */
  fillPick(all: boolean): void;
  fillSkip(): void;
  fillBack(): void;
  fillCancel(): void;
  /** Shows what updating a copy to the shelf's newer version would change; the update itself is `applyBehaviorUpdate`. */
  showBehaviorUpdate(scriptId: string | undefined): void;
  applyBehaviorUpdate(scriptId: string): void;
  /** The key that switches a script on and off; undefined takes it away. */
  setScriptKey(scriptId: string, key: string | undefined): void;
}

type Actions = ScriptActions & Pick<ScriptEditorActions, 'checkScript' | 'setScriptParam' | 'beginTextEdit' | 'endTextEdit'> & Pick<BuilderActions, 'setControlsFor' | 'showScript' | 'select'> & Pick<PartActions, 'addTag'>;

const parts = (n: number): string => `${n} part${n === 1 ? '' : 's'}`;

/** One line for what a script reaches: "Drives 12 parts", "Drives 4 parts, likely 24 more", "Reaches no part by a plain name". */
function reachText(v: ScriptShow): string {
  if (v.reached.length === 0 && v.fits.length === 0) return v.buildsTargets ? 'Picks its parts in its own code' : 'Reaches no part';
  if (v.reached.length === 0) return `Likely drives ${parts(v.fits.length)}`;
  return `Drives ${parts(v.reached.length)}${v.fits.length > 0 ? `, likely ${v.fits.length} more` : ''}`;
}

/** What the sandbox says of a script's text, kept by text: cards are drawn far more often than scripts change. */
const checked = new Map<string, ScriptCheck>();
function checkOnce(source: string, name: string, check: Actions['checkScript']): ScriptCheck | undefined {
  const had = checked.get(source);
  if (had) return had;
  const r = check(source, name);
  if (!r) return undefined;
  if (checked.size > 200) checked.clear();
  checked.set(source, r);
  return r;
}

/** A script's params for its card: the sandbox's list (it ran the code) with the words read off the text beside each. */
export function cardParams(text: readonly ParamInfo[], real: Record<string, ParamSpec> | undefined): ParamInfo[] {
  if (!real) return [...text];
  return Object.entries(real).map(([name, spec]) => {
    const help = text.find((t) => t.name === name)?.help;
    return { name, default: spec.default, ...(spec.min !== undefined ? { min: spec.min } : {}), ...(spec.max !== undefined ? { max: spec.max } : {}), ...(help !== undefined ? { help } : {}) };
  });
}

/**
 * The Behaviors tab (M16): each script on the robot as a card, and the shelf of shared behaviors to add from. A
 * behavior from the shelf shows where it came from, its slots and its settings as sliders; an ordinary script gets a
 * plainer card. A card's Show switch lights the board with what the script drives.
 */
export function ScriptsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: Actions }) {
  // M7: the picked core's scripts (the same pick as the Keys tab).
  const scripts = useStore(store, (s) => s.builder.controls.scripts);
  const main = useStore(store, (s) => s.builder.controls.core === undefined);
  const core = useStore(store, (s) => s.builder.controlsFor);
  const draft = useStore(store, (s) => s.builder.draft);
  const open = useStore(store, (s) => s.scriptEditor);
  const pinned = useStore(store, (s) => s.builder.shownPinned);
  const shelf = useStore(store, (s) => s.shelf);
  const filling = useStore(store, (s) => s.builder.fill !== undefined);
  const [adding, setAdding] = useState(false);
  const views = useMemo(() => new Map(scripts.map((s) => [s.id, showScript(draft, registry, core, s.id)])), [draft, core, scripts]);
  const cards = useMemo(() => behaviorCards(draft, registry, shelf.entries, core), [draft, core, shelf.entries]);
  const offers = useMemo(() => shelfOffers(draft, registry, shelf.entries, core), [draft, core, shelf.entries]);
  // The shelf is read when the tab is first shown, and again each time the list is opened (a file may have been added).
  useEffect(() => actions.loadShelf(), []);
  const listOpen = adding || scripts.length === 0;
  return (
    <>
      <div class="sec">
        <div class="h">
          On this robot <span>plain .js files</span>
        </div>
        <ControlsFor store={store} actions={actions} />
        {scripts.length === 0 && <p class="dim small">Nothing yet. A behavior is a script that runs every tick with exact data: add one from the shelf below, or write your own.</p>}
        {cards.map((card) => {
          const spec = scripts.find((s) => s.id === card.id);
          const v = views.get(card.id);
          if (!spec) return null;
          return <Card key={card.id} card={card} view={v} lit={pinned === card.id} editing={open === card.id} main={main} params={spec.params} source={typeof spec.source === 'string' ? spec.source : undefined} draft={draft} registry={registry} actions={actions} busy={filling} />;
        })}
      </div>
      <div class="sec">
        <div class="h">
          Add a behavior <span>from the shelf</span>
        </div>
        {!listOpen ? (
          <div class="acts" style={{ marginTop: 0 }}>
            <Button
              onClick={() => {
                actions.loadShelf();
                setAdding(true);
              }}
              disabled={filling}
              title="Shared behaviors that work on any robot with the right kind of parts"
            >
              Add a behavior
            </Button>
            <Button kind="ghost" onClick={actions.addScript} disabled={filling} title="A blank script of your own, opened in the script view">
              Write your own
            </Button>
          </div>
        ) : (
          <>
            {shelf.error !== undefined && <p class="warn-text small">The shelf could not be read: {shelf.error}</p>}
            {shelf.error === undefined && !shelf.loaded && <p class="dim small">Reading the shelf...</p>}
            {shelf.loaded && offers.length === 0 && <p class="dim small">The shelf is empty. A behavior is a .js file in the behaviors folder.</p>}
            {offers.map((o) => (
              <button
                type="button"
                key={o.entry.id}
                class={`shelf-row${o.ok ? '' : ' no'}`}
                disabled={!o.ok || filling}
                title={o.ok ? `Add ${o.entry.header.name}: you pick its parts on the board next` : `${o.entry.header.name} ${o.reason ?? ''}`}
                onClick={() => {
                  setAdding(false);
                  actions.addBehavior(o.entry.id);
                }}
              >
                <span class="hd">
                  <b class="h">{o.entry.header.name}</b>
                  <span class="add">{o.ok ? (o.here.length > 0 ? '+ add another' : '+ add') : ''}</span>
                </span>
                <span class="about">{o.entry.header.about}</span>
                {!o.ok && <span class="why">{o.reason}</span>}
                {o.ok && o.here.length > 0 && <span class="why here">already on this robot</span>}
              </button>
            ))}
            <div class="acts">
              <Button kind="ghost" onClick={actions.addScript} disabled={filling} title="A blank script of your own, opened in the script view">
                Write your own
              </Button>
              {scripts.length > 0 && (
                <Button kind="ghost" onClick={() => setAdding(false)}>
                  Close
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

interface CardProps {
  card: BehaviorCard;
  view: ScriptShow | undefined;
  lit: boolean;
  editing: boolean;
  main: boolean;
  params: Readonly<Record<string, number>>;
  source: string | undefined;
  draft: AppState['builder']['draft'];
  registry: PartRegistry;
  actions: Actions;
  /** A slot is being filled on the board: the card's own buttons wait. */
  busy: boolean;
}

/** One script: a behavior from the shelf with its slots and where it came from, or an ordinary script. */
function Card({ card, view: v, lit, editing, main, params, source, draft, registry, actions, busy }: CardProps) {
  const [about, setAbout] = useState(false);
  const h = card.header;
  const check = source !== undefined ? checkOnce(source, card.file ?? `${card.id}.js`, actions.checkScript) : undefined;
  const list = cardParams(card.params, check?.ok ? check.params : undefined);
  const from = card.from;
  return (
    <div class={`beh${lit ? ' lit' : ''}${h ? ' shelf' : ''}`}>
      <div class="hd">
        {h ? (
          <b class="h name">{h.name}</b>
        ) : (
          <input
            class="field mono"
            value={card.id}
            title="The script's name: its file is named after it, and a key switches it by this name"
            aria-label="script name"
            onChange={(e) => actions.renameScript(card.id, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
        )}
        <ScriptKey id={card.id} value={card.key} onSet={(key) => actions.setScriptKey(card.id, key)} />
      </div>
      {h && h.about !== '' && <div class="about">{h.about}</div>}
      {h && (
        <div class="origin">
          {from ? (
            <span>
              {from.gone ? `from the shelf (${from.id}, no longer there)` : 'from the shelf'}, version {from.version}
              {from.edited ? ', edited here' : ''}
            </span>
          ) : (
            <span>written as a behavior, version {h.version}</span>
          )}
          {from?.newer !== undefined && (
            <Button small onClick={() => actions.showBehaviorUpdate(card.id)} disabled={busy} title={`The shelf has version ${from.newer}. See what changed before anything is replaced.`}>
              update to {from.newer}
            </Button>
          )}
          <button type="button" class="linkish" aria-expanded={about} onClick={() => setAbout(!about)}>
            about
          </button>
        </div>
      )}
      {h && about && (
        <div class="notes">
          {h.notes.length === 0 && <p>No notes.</p>}
          {h.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
          <p class="file">
            script <b>{card.id}</b>
            {card.file !== undefined ? `, saved as ${card.file}` : ', written to a file at the next save'}
          </p>
        </div>
      )}
      {!h && <div class="origin">{card.file !== undefined ? <span class="mono">{card.file}</span> : <span>your own script: written to a file at the next save</span>}</div>}
      {!card.loaded && <p class="warn-text small">Its file was not found, so there is no code to run.</p>}
      {check && !check.ok && <p class="warn-text small">It does not start: {check.error.message}. Edit code shows where.</p>}
      {card.problems.map((p) => (
        <p class="warn-text small" key={p}>
          {p}
        </p>
      ))}
      <Check checked={card.enabled} onChange={(on) => actions.setScriptEnabled(card.id, on)} title={main ? 'It runs as soon as the robot is in the world' : "It runs as soon as this core's piece breaks off"}>
        {main ? 'on at start' : 'on at release'}
      </Check>

      {card.slots.length > 0 && (
        <div class="slots">
          {card.slots.map((s) => (
            <div class="srow" key={s.slot.group} title={`Parts in the group "${s.tag}". Any part with ${s.slot.inputs.length === 1 ? `a ${s.slot.inputs[0]} input` : `one of the inputs ${s.slot.inputs.join(', ')}`} can be in it.`}>
              <span class="lbl">{s.slot.label}</span>
              <button type="button" class={`linkish n${s.filled.length === 0 ? ' none' : ''}`} disabled={s.filled.length === 0} onClick={() => actions.select(s.filled)} title="Select them on the board">
                {slotText(draft, registry, s)}
              </button>
              <Button small onClick={() => actions.changeSlot(card.id, s.slot.group)} disabled={busy || s.could === 0} title={s.could === 0 ? 'Nothing on this robot could fill it' : 'Pick its parts again on the board'}>
                change
              </Button>
            </div>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div class="pars">
          {list.map((p) => (
            <Param key={p.name} p={p} value={params[p.name] ?? p.default} actions={actions} id={card.id} />
          ))}
        </div>
      )}

      {v && (
        <div class="reach">
          <span>
            <i class="sw solid" />
            {reachText(v)}
            {v.undriven.length > 0 && <b class="warn-text">, {v.undriven.length} not driven</b>}
          </span>
          <Button small on={lit} onClick={() => actions.showScript(lit ? undefined : card.id)} title={lit ? 'Put the light out (or press Esc)' : 'Light the board with what this script drives'}>
            {lit ? 'Lit' : 'Show'}
          </Button>
        </div>
      )}
      {v && lit && <ReachDetails v={v} registry={registry} draft={draft} actions={actions} />}
      {v && !lit && v.undriven.length > 0 && <Undriven v={v} registry={registry} draft={draft} actions={actions} />}
      <div class="acts">
        <Button small on={editing} onClick={() => actions.openScript(card.id)} disabled={busy} title="This robot's own copy of the code">
          Edit code
        </Button>
        <Button small kind="ghost" onClick={() => actions.removeScript(card.id)} disabled={busy}>
          Remove
        </Button>
      </div>
    </div>
  );
}

/**
 * A setting as a slider with its number beside it and what it means under it. One drag is one undo step. An on/off
 * setting (`isOnOff`) is a switch instead; it is still 0 or 1 in the blueprint.
 */
function Param({ p, value, id, actions }: { p: ParamInfo; value: number; id: string; actions: Actions }) {
  const r = sliderRange(p, value);
  const set = (v: number): void => actions.setScriptParam(id, p.name, v !== p.default ? v : undefined);
  if (isOnOff(p, value)) {
    return (
      <div class="par">
        <span class="lbl" title={`default ${p.default === 1 ? 'on' : 'off'}`}>
          {p.name}
        </span>
        <span class="sl onoff">
          <Switch on={value === 1} onChange={(on) => set(on ? 1 : 0)} title={`On is 1, off is 0. Default ${p.default === 1 ? 'on' : 'off'}.`}>
            {value === 1 ? 'on' : 'off'}
          </Switch>
        </span>
        {p.help !== undefined && <span class="phelp">{p.help}</span>}
      </div>
    );
  }
  return (
    <div class="par">
      <span class="lbl" title={`default ${num(p.default)}`}>
        {p.name}
      </span>
      <span
        class="sl"
        onPointerDown={actions.beginTextEdit}
        onPointerUp={actions.endTextEdit}
        onPointerCancel={actions.endTextEdit}
        onDblClick={() => set(p.default)}
        title={`${num(r.min)} to ${num(r.max)}. Double-click for the default, ${num(p.default)}.`}
      >
        <Slider value={value} min={r.min} max={r.max} step={r.step} onChange={(v) => set(Number(v.toPrecision(6)))} label={p.name} />
      </span>
      <NumberField value={Number(value.toPrecision(6))} label={`${p.name} value`} onChange={(v) => set(p.min !== undefined || p.max !== undefined ? Math.min(p.max ?? v, Math.max(p.min ?? v, v)) : v)} />
      {p.help !== undefined && <span class="phelp">{p.help}</span>}
    </div>
  );
}

/** The key that switches a script on and off: click, then press the key. Backspace takes it away, Esc leaves it. */
function ScriptKey({ id, value, onSet }: { id: string; value: string | undefined; onSet(key: string | undefined): void }) {
  const [waiting, setWaiting] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const latest = useRef(onSet);
  latest.current = onSet;
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent): void => {
      // Cmd+S and the like are not a key for the robot: they do what they always do.
      if (e.metaKey || e.ctrlKey) return setWaiting(false);
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
      if (e.key === 'Escape') return setWaiting(false);
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setWaiting(false);
        return latest.current(undefined);
      }
      const reserved = worldKeyLabel(e.code);
      if (reserved) return setRefused(`${reserved}, so it cannot switch a script. Letters and digits are all yours.`);
      setRefused(undefined);
      setWaiting(false);
      latest.current(keyName(e));
    };
    const away = (): void => setWaiting(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [waiting]);
  useEffect(() => {
    if (!waiting) setRefused(undefined);
  }, [waiting]);
  const shown = value === undefined ? undefined : value.length === 1 ? value.toUpperCase() : value;
  return (
    <span class="skey">
      {refused !== undefined && <span class="refusal plate float">{refused}</span>}
      <button
        type="button"
        class={`cap small${waiting ? ' wait' : shown === undefined ? ' none' : ''}`}
        aria-label={`key that switches ${id} on and off`}
        title={shown === undefined ? 'No key switches it on and off. Click, then press one.' : `${shown} switches it on and off in the world. Click to change it; Backspace takes the key away.`}
        onClick={() => setWaiting(!waiting)}
      >
        {waiting ? 'press' : (shown ?? '+ key')}
      </button>
    </span>
  );
}

/** The names a script uses and how many parts answer to each, and whether the list can be trusted to be all of it. */
function ReachDetails({ v, registry, draft, actions }: { v: ScriptShow; registry: PartRegistry; draft: AppState['builder']['draft']; actions: Actions }) {
  return (
    <div class="reach-more">
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
    <div class="undriven">
      <div class="uh">
        <i class="sw miss" />
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
