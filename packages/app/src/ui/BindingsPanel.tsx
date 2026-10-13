import { useEffect, useState } from 'preact/hooks';
import type { Binding, Blueprint, PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { autoSummary, bindingTargets, channelsForTarget } from '../builder/bindings';
import type { ControlsView } from '../builder/coreControls';
import {
  bindingSentence,
  bindingWhat,
  fullValue,
  INPUT_MODES,
  KEYBOARD,
  keyLabel,
  keyOwners,
  kindWords,
  MODE_HELP,
  MODE_WORDS,
  ownerKind,
  patchBinding,
  reachOf,
  retarget,
  targetWords,
  valueWords,
  type InputMode,
  type KeyOwner,
} from '../builder/keys';
import { ControlsFor } from './ControlsFor';
import type { BuilderActions } from './actions';
import { Button, KeyCap, Segmented, Select, Slider, Switch, type SelectOption } from './kit';
import { useKeyWait } from './keyWait';

export interface BindingActions {
  setBindings(bindings: Binding[]): void;
  setAutoControls(on: boolean): void;
  /**
   * Makes these parts' auto keys yours: auto goes off for them and the same keys are written as bindings, in one undo
   * step. `byKind` writes one binding for a whole kind of part where that says the same thing.
   */
  claimAuto(ids: string[], byKind: boolean): void;
  /** Lights up these parts on the board (what a key drives, or would); undefined puts the light out. */
  lightParts(ids: readonly string[] | undefined): void;
  /** A slider drag starts (true) or ends (false): everything it sets in between is one undo step. */
  dragValue(on: boolean): void;
}

type Actions = BindingActions & Pick<BuilderActions, 'setControlsFor'>;

/**
 * The Keys tab (M16 step 6): a drawn keyboard with every key lit by who owns it, and under it what the picked key
 * does, as sentences you can edit. A free key takes a new binding. It edits the same binding list the Part tab's
 * input rows do; nothing about the file or about how keys are arbitrated is different.
 */
export function BindingsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: Actions }) {
  const draft = useStore(store, (s) => s.builder.draft);
  // M7: the picked core's controls (the main core's are the blueprint's top level).
  const controls = useStore(store, (s) => s.builder.controls);
  // Another robot opened: the key picked on the last one means nothing here.
  const robot = useStore(store, (s) => `${s.doc.file ?? ''}\0${s.doc.name}`);
  const main = controls.core === undefined;
  const scope = controls.scope;
  const bindings = controls.bindings;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<number | undefined>(undefined);
  const wait = useKeyWait<number>((index, key) => {
    actions.setBindings(patchBinding(bindings, index, { key }));
    setPicked(key);
  });
  useEffect(() => {
    setPicked(undefined);
    setOpen(undefined);
    wait.cancel();
  }, [controls.core, robot]);
  useEffect(() => () => actions.lightParts(undefined), []);

  const owners = keyOwners(draft, registry, controls);
  const auto = main ? autoSummary(draft, registry) : [];
  const drawn = new Set(KEYBOARD.flatMap((r) => r.keys.map((k) => k.key)));
  const others = [...owners.values()].filter((o) => !drawn.has(o.key));
  const light = (b: Binding | undefined): void => actions.lightParts(b && b.mode !== 'script' && b.target !== undefined ? reachOf(draft, registry, b.target, b.channel, scope) : undefined);
  const pick = (key: string): void => {
    setOpen(undefined);
    setPicked(picked === key ? undefined : key);
  };
  const keyClass = (o: KeyOwner | undefined, key: string): string => `k ${ownerKind(o)}${o && o.yours.length > 0 && o.scripts.length > 0 ? ' and-script' : ''}${o?.clash ? ' clash' : ''}${picked === key ? ' pick' : ''}`;
  const keyTitle = (o: KeyOwner | undefined, label: string): string => {
    const kind = ownerKind(o);
    if (kind === 'world') return `${o?.world ?? ''}. It cannot drive the robot.`;
    if (kind === 'free') return `${label} is free. Click to give it something to do.`;
    const n = (o?.yours.length ?? 0) + (o?.scripts.length ?? 0) + (o?.auto.length ?? 0);
    return `${label}: ${kind === 'yours' ? 'yours' : kind === 'script' ? 'switches a script' : 'an auto key'}${n > 1 ? `, ${n} things` : ''}${o?.clash ? '. It does two unrelated things.' : ''} Click to see and edit.`;
  };
  const used = [...owners.values()].filter((o) => o.yours.length + o.scripts.length + o.auto.length > 0);

  return (
    <>
      <div class="sec">
        <div class="h">
          Keys <span>click a key to see or change what it does</span>
        </div>
        <ControlsFor store={store} actions={actions} />
        {!main && <p class="dim small">These start when this core's piece breaks off (a decoupler fires, or a blast cuts it free).{scope !== undefined ? ` Its keys reach only ${scope}'s own parts.` : ''}</p>}
        <Switch on={controls.autoOn} onChange={(on) => actions.setAutoControls(on)} title="Auto keys: the game gives a part its key because of what it is. Off: only your own keys drive this robot.">
          Auto keys
        </Switch>
        <p class="auto-line">
          {!controls.autoOn
            ? 'Off: only your own keys drive it.'
            : !main
              ? "Its piece's parts get their auto keys when it wakes."
              : auto.length === 0
                ? 'No part here has an auto key yet.'
                : auto.map((l, i) => (
                    <>
                      {i > 0 ? ', ' : ''}
                      <b>{l.key}</b> {l.text}
                    </>
                  ))}
        </p>
      </div>

      <div class="sec">
        <div class="kb" role="group" aria-label="keyboard">
          {KEYBOARD.map((row, r) => (
            <div class="r" key={r} style={{ marginLeft: `calc(var(--k) * ${row.indent})` }}>
              {row.keys.map((k) => {
                const o = owners.get(k.key);
                return (
                  <button type="button" key={k.code} class={keyClass(o, k.key)} style={k.w !== undefined ? { width: `calc(var(--k) * ${k.w})` } : undefined} title={keyTitle(o, k.label)} aria-pressed={picked === k.key} data-key={k.key} onClick={() => pick(k.key)}>
                    {k.label}
                  </button>
                );
              })}
            </div>
          ))}
          {others.length > 0 && (
            <div class="r others" title="Keys bound in this robot's file that are not drawn above">
              <span class="lbl">also</span>
              {others.map((o) => (
                <button type="button" key={o.key} class={`${keyClass(o, o.key)} wide`} title={keyTitle(o, keyLabel(o.key))} data-key={o.key} onClick={() => pick(o.key)}>
                  {keyLabel(o.key)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div class="kb-legend">
          <span>
            <i class="k yours" /> yours
          </span>
          <span>
            <i class="k auto" /> auto
          </span>
          <span>
            <i class="k script" /> switches a script
          </span>
          <span>
            <i class="k world" /> the world's
          </span>
          <span title="One key doing two unrelated things. It is allowed.">
            <i class="k yours clash" /> two things
          </span>
        </div>
      </div>

      <div class="sec">
        {picked === undefined ? (
          <>
            <div class="h">
              Everything bound <span>{used.length === 0 ? '' : `${used.length} ${used.length === 1 ? 'key' : 'keys'}`}</span>
            </div>
            {used.length === 0 && <p class="dim">No keys yet. Click a key above to give it something to do, or select a part and use + key on one of its inputs.</p>}
            {used.map((o) => (
              <button type="button" class="ksum" key={o.key} onClick={() => pick(o.key)} onPointerEnter={() => actions.lightParts(reachOfKey(draft, registry, controls, o))} onPointerLeave={() => actions.lightParts(undefined)} title="Click to edit this key">
                <KeyCap small auto={ownerKind(o) === 'auto'}>
                  {keyLabel(o.key)}
                </KeyCap>
                <span class="lines">
                  {o.yours.map((i) => {
                    const b = bindings[i];
                    return b ? (
                      <span key={`y${i}`}>
                        {MODE_WORDS[b.mode]}: {bindingWhat(draft, registry, b, scope)}
                      </span>
                    ) : null;
                  })}
                  {o.scripts.map((i) => (
                    <span key={`s${i}`}>switches {bindings[i]?.script || 'no script yet'}.js on and off</span>
                  ))}
                  {o.auto.map((a) => (
                    <span key={`a${a.text}`} class="dim">
                      auto: {a.text}
                    </span>
                  ))}
                </span>
                {o.clash && <i class="clash-dot" title="It does two unrelated things" />}
              </button>
            ))}
          </>
        ) : (
          <KeyDetail
            draft={draft}
            registry={registry}
            controls={controls}
            owner={owners.get(picked) ?? { key: picked, yours: [], scripts: [], auto: [], clash: false }}
            open={open}
            setOpen={setOpen}
            wait={wait}
            light={light}
            actions={actions}
            onClose={() => setPicked(undefined)}
          />
        )}
      </div>
    </>
  );
}

/** Every part a key drives under these controls, to light up. */
function reachOfKey(bp: Blueprint, registry: PartRegistry, controls: ControlsView, o: KeyOwner): string[] {
  const ids = new Set<string>(o.auto.flatMap((a) => a.ids));
  for (const i of o.yours) {
    const b = controls.bindings[i];
    if (b?.target !== undefined) for (const id of reachOf(bp, registry, b.target, b.channel, controls.scope)) ids.add(id);
  }
  return bp.parts.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/** What the picked key does, one sentence a row, each of yours with "more" to change it; and what to add to it. */
function KeyDetail({
  draft,
  registry,
  controls,
  owner,
  open,
  setOpen,
  wait,
  light,
  actions,
  onClose,
}: {
  draft: Blueprint;
  registry: PartRegistry;
  controls: ControlsView;
  owner: KeyOwner;
  open: number | undefined;
  setOpen(i: number | undefined): void;
  wait: ReturnType<typeof useKeyWait<number>>;
  light(b: Binding | undefined): void;
  actions: Actions;
  onClose(): void;
}) {
  const scope = controls.scope;
  const bindings = controls.bindings;
  const label = keyLabel(owner.key);
  const targets = bindingTargets(draft, registry, scope);
  const targetOptions: SelectOption[] = [
    ...targets.tags.map((t) => ({ value: t, label: t, group: 'Groups' })),
    ...targets.types.map((t) => ({ value: t, label: kindWords(registry, t), group: 'Kinds of part' })),
    ...targets.parts.map((t) => ({ value: t, label: targetWords(draft, registry, t, scope).replace(/^the /, ''), group: 'Single parts' })),
  ];
  const known = new Set([...targets.tags, ...targets.types, ...targets.parts]);
  const add = (b: Binding): void => {
    actions.setBindings([...bindings, b]);
    setOpen(bindings.length);
  };
  const remove = (i: number): void => {
    setOpen(undefined);
    light(undefined);
    actions.setBindings(bindings.filter((_, n) => n !== i));
  };
  const nothing = owner.yours.length + owner.scripts.length + owner.auto.length === 0;

  return (
    <>
      <div class="h kd-head">
        <span>
          Key <KeyCap small>{label}</KeyCap>
        </span>
        <button type="button" class="linkish" onClick={onClose}>
          all keys
        </button>
      </div>
      {owner.world !== undefined ? (
        <p class="warn-text">{owner.world}, so it cannot drive the robot. Letters, digits and the arrow keys are all yours.</p>
      ) : (
        <>
          {nothing && <p class="dim">{label} is free. Give it something to do:</p>}
          {owner.clash && <p class="warn-text small">This key does two unrelated things at once. That is allowed: check it is what you want.</p>}
          {owner.yours.map((i) => {
            const b = bindings[i];
            if (!b) return null;
            const channels = channelsForTarget(draft, registry, b.target ?? '', scope);
            const ch = channels.find((c) => c.name === b.channel);
            const range = ch ?? { min: -1, max: 1 };
            const value = b.value ?? fullValue(range);
            const missing = b.target === undefined || !known.has(b.target);
            const isOpen = open === i;
            const waiting = wait.waiting === i;
            return (
              <div class={`kline yours${isOpen ? ' open' : ''}${missing ? ' missing' : ''}`} key={i} onPointerEnter={() => light(b)} onPointerLeave={() => light(undefined)}>
                <div class="kl-top">
                  <button type="button" class={`cap small${waiting ? ' wait' : ''}`} title={waiting ? 'Press the new key. Esc, or a click here, calls it off.' : 'Click, then press another key to move this to it'} {...wait.capProps(i)}>
                    {waiting ? '...' : label}
                  </button>
                  <span class="what sentence">{bindingSentence(draft, registry, b, scope).replace(/^[^,]+, /, '')}</span>
                  <button type="button" class="more-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : i)} title="Change who it drives, which input, how, how much; or remove it">
                    more {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {waiting && wait.refused !== undefined && <p class="warn-text small">{wait.refused}</p>}
                {missing && <p class="warn-text small">Nothing on this robot answers to "{b.target ?? ''}" any more. Pick who it drives.</p>}
                {isOpen && (
                  <div class="kl-more">
                    <div class="pair">
                      <span class="lbl">drives</span>
                      <Select value={b.target} options={targetOptions} placeholder={missing ? `${b.target ?? ''} (missing)` : '(nothing to drive)'} onChange={(t) => actions.setBindings(retarget(draft, registry, controls, i, t))} label="who it drives" />
                    </div>
                    <div class="pair">
                      <span class="lbl">input</span>
                      <Select
                        value={b.channel}
                        options={channels.map((c) => ({ value: c.name, label: c.name }))}
                        placeholder={b.channel || '(no inputs)'}
                        onChange={(channel) => {
                          const next = channels.find((c) => c.name === channel);
                          actions.setBindings(patchBinding(bindings, i, { channel, ...(next ? { value: Math.min(next.max, Math.max(next.min, value)) } : {}) }));
                        }}
                        label="which input"
                      />
                    </div>
                    <Segmented options={INPUT_MODES.map((x) => ({ value: x, label: MODE_WORDS[x], title: MODE_HELP[x] }))} value={b.mode as InputMode} onChange={(mode) => actions.setBindings(patchBinding(bindings, i, { mode }))} label="how the key works" />
                    <div class="val" title={`How much it drives the input: ${valueWords(range.min, range)} to ${valueWords(range.max, range)}`}>
                      <span class="lbl">how much</span>
                      <Slider value={Math.round(value * 100)} min={range.min * 100} max={range.max * 100} step={5} label="how much" onDrag={actions.dragValue} onChange={(v) => actions.setBindings(patchBinding(bindings, i, { value: Math.min(range.max, Math.max(range.min, v / 100)) }))} />
                      <b>{valueWords(value, range)}</b>
                    </div>
                    <Button small kind="danger" onClick={() => remove(i)} title="Take this off the key">
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {owner.scripts.map((i) => {
            const b = bindings[i];
            if (!b) return null;
            const isOpen = open === i;
            const waiting = wait.waiting === i;
            const gone = !controls.scripts.some((s) => s.id === b.script);
            return (
              <div class={`kline yours script${isOpen ? ' open' : ''}${gone ? ' missing' : ''}`} key={i}>
                <div class="kl-top">
                  <button type="button" class={`cap small${waiting ? ' wait' : ''}`} title={waiting ? 'Press the new key. Esc, or a click here, calls it off.' : 'Click, then press another key to move this to it'} {...wait.capProps(i)}>
                    {waiting ? '...' : label}
                  </button>
                  <span class="what sentence">{bindingSentence(draft, registry, b, scope).replace(/^[^:]+: /, '')}</span>
                  <button type="button" class="more-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : i)} title="Change which script, or remove it">
                    more {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {waiting && wait.refused !== undefined && <p class="warn-text small">{wait.refused}</p>}
                {gone && <p class="warn-text small">This robot has no script called "{b.script ?? ''}". Pick one.</p>}
                {isOpen && (
                  <div class="kl-more">
                    <div class="pair">
                      <span class="lbl">script</span>
                      <Select value={b.script} options={controls.scripts.map((s) => ({ value: s.id, label: `${s.id}.js` }))} placeholder="(add a script first)" onChange={(script) => actions.setBindings(patchBinding(bindings, i, { script }))} label="which script" />
                    </div>
                    <Button small kind="danger" onClick={() => remove(i)} title="Take this off the key">
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {owner.auto.map((a) => (
            <button
              type="button"
              class="kline auto"
              key={`a${a.text}`}
              onPointerEnter={() => actions.lightParts(a.ids)}
              onPointerLeave={() => actions.lightParts(undefined)}
              onClick={() => actions.claimAuto(a.ids, true)}
              title={`An auto key. Click to make it yours: auto goes off for ${a.ids.length === 1 ? 'that part' : `those ${a.ids.length} parts`} and their keys are written as your own, which you can then change. One undo step.`}
            >
              <KeyCap small auto>
                {label}
              </KeyCap>
              <span class="tag">auto</span>
              <span class="what">
                {a.text}, {a.channel} {valueWords(a.value, { min: -1 })}
              </span>
              <span class="mk">make {a.ids.length === 1 ? 'it' : 'them'} mine</span>
            </button>
          ))}
          <div class="kd-add">
            <div class="pair">
              <span class="lbl">{nothing ? 'drive' : 'also drive'}</span>
              <Select
                value={undefined}
                options={targetOptions}
                placeholder={targetOptions.length === 0 ? 'nothing here has an input yet' : 'pick a group, a kind or a part'}
                label={`what ${label} drives`}
                title={`A new binding on ${label}: it drives the first input of what you pick, while held, at full. Change any of it under "more".`}
                onChange={(target) => {
                  const ch = channelsForTarget(draft, registry, target, scope)[0];
                  if (ch) add({ key: owner.key, mode: 'hold', target, channel: ch.name, value: fullValue(ch) });
                }}
              />
            </div>
            {controls.scripts.length > 0 && (
              <div class="pair">
                <span class="lbl">or switch</span>
                <Select value={undefined} options={controls.scripts.map((s) => ({ value: s.id, label: `${s.id}.js` }))} placeholder="a script on and off" label={`the script ${label} switches`} onChange={(script) => add({ key: owner.key, mode: 'script', script })} />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
