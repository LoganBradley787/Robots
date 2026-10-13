import { useEffect, useState } from 'preact/hooks';
import type { Binding, Blueprint, PartDef, PartRegistry, PlacedPart } from '@robots/sim-core';
import type { ControlsView } from '../builder/coreControls';
import type { PartInputs } from '../builder/scriptView';
import { bindFromPart, fullValue, INPUT_MODES, inputAutoKeys, inputBindings, keyLabel, MODE_HELP, MODE_WORDS, partScopes, patchBinding, rangeWords, reachOf, retarget, valueWords, type InputBinding, type InputMode, type Scope } from '../builder/keys';
import type { BindingActions } from './BindingsPanel';
import type { BuilderActions } from './actions';
import { Button, KeyCap, Segmented, Slider } from './kit';
import { useKeyWait } from './keyWait';

type Actions = BindingActions & Pick<BuilderActions, 'revealScript' | 'showTab'>;

/**
 * A part's inputs, each a row you bind from (M16 step 6): its name and range, a `+ key` cap, then everything that
 * drives it today. Your keys can be edited where they stand (who they drive, how, how much). Auto keys are rows too,
 * greyed: a click makes one yours. Scripts are named and open the Behaviors tab.
 */
export function InputRows({ draft, registry, part, def, controls, cores, driven, actions }: { draft: Blueprint; registry: PartRegistry; part: PlacedPart; def: PartDef; controls: ControlsView; cores: number; driven: PartInputs | undefined; actions: Actions }) {
  // Which of your bindings has its "more" open, by its place in the list.
  const [open, setOpen] = useState<number | undefined>(undefined);
  const scopes = partScopes(draft, registry, part.id, controls.scope);
  const wait = useKeyWait<string>((id, key) => {
    const [what, rest = ''] = id.split(':');
    if (what === 'new') actions.setBindings([...bindFromPart(draft, registry, controls, key, part.id, rest)]);
    else actions.setBindings(patchBinding(controls.bindings, Number(rest), { key }));
  });
  // Another part, or another core's keys: nothing stays open or lit from the last one.
  useEffect(() => {
    setOpen(undefined);
    wait.cancel();
    return () => actions.lightParts(undefined);
  }, [part.id, controls.core]);
  const light = (target: string | undefined, channel: string): void => actions.lightParts(target === undefined ? undefined : reachOf(draft, registry, target, channel, controls.scope));

  return (
    <div class="sec">
      <div class="h">
        Inputs <span>click + key, then press a key</span>
      </div>
      {def.inputs.length === 0 && <p class="dim">Nothing to control on this part.</p>}
      {cores > 1 && def.inputs.length > 0 && (
        <p class="dim small">
          Keys here are {controls.core === undefined ? "the main core's" : `${controls.scope ?? controls.core}'s`}.{' '}
          <button type="button" class="linkish" onClick={() => actions.showTab('keys')}>
            The Keys tab picks whose.
          </button>
        </p>
      )}
      {def.inputs.map((c) => {
        const mine = inputBindings(draft, registry, controls, part.id, c.name);
        const auto = inputAutoKeys(draft, registry, controls, part.id, c.name);
        const by = driven?.inputs.get(c.name) ?? [];
        const scripts = by.filter((d) => d.kind === 'script');
        // Keys another core's controls put on it: shown, edited from that core's Keys tab.
        const others = by.filter((d) => d.kind === 'key' && !mine.some((m) => m.binding.key === d.name));
        const newId = `new:${c.name}`;
        const waitingNew = wait.waiting === newId;
        return (
          <div class="irow" key={c.name}>
            <div class="ihead">
              <div>
                <div class="nm">{c.name}</div>
                <div class="rg">{rangeWords(c)}</div>
              </div>
              <button type="button" class={`cap none${waitingNew ? ' wait' : ''}`} title={waitingNew ? 'Press the key. Esc, or a click here, calls it off.' : `Bind a key to ${c.name}: click, then press it`} {...wait.capProps(newId)}>
                {waitingNew ? 'press a key' : '+ key'}
              </button>
            </div>
            {waitingNew && wait.refused !== undefined && <p class="warn-text small">{wait.refused}</p>}
            {mine.map((m) => (
              <KeyLine
                key={m.index}
                m={m}
                channel={c}
                scopes={scopes}
                open={open === m.index}
                onOpen={() => setOpen(open === m.index ? undefined : m.index)}
                waiting={wait.waiting === `key:${m.index}`}
                refused={wait.waiting === `key:${m.index}` ? wait.refused : undefined}
                capProps={wait.capProps(`key:${m.index}`)}
                onScope={(target) => actions.setBindings(retarget(draft, registry, controls, m.index, target))}
                onHover={(target) => light(target, c.name)}
                onPatch={(patch) => actions.setBindings(patchBinding(controls.bindings, m.index, patch))}
                onDrag={actions.dragValue}
                onRemove={() => {
                  setOpen(undefined);
                  actions.lightParts(undefined);
                  actions.setBindings(controls.bindings.filter((_, i) => i !== m.index));
                }}
              />
            ))}
            {auto.map((b) => (
              <button
                type="button"
                class="kline auto"
                key={`a${b.key}${b.value}`}
                onClick={() => actions.claimAuto([part.id], false)}
                title="An auto key: the game gave it this key because of what the part is. Click to make it yours: auto goes off for this part and the same key is written as your own, which you can then change. One undo step."
              >
                <KeyCap small auto>
                  {keyLabel(b.key)}
                </KeyCap>
                <span class="tag">auto</span>
                <span class="what">
                  {MODE_WORDS.hold}, {valueWords(b.value ?? 0, c)}
                </span>
                <span class="mk">make it mine</span>
              </button>
            ))}
            {others.map((d) => (
              <div class="kline other" key={`o${d.name}`} title={`A key of another core's controls, bound to "${d.via}". The Keys tab picks whose keys you edit.`}>
                <KeyCap small>{keyLabel(d.name)}</KeyCap>
                <span class="what">another core's key</span>
              </div>
            ))}
            {scripts.map((d) => (
              <button
                type="button"
                class="kline script"
                key={`s${d.core ?? ''}${d.name}`}
                title={`This script writes it, through the name "${d.via}"${d.line !== undefined ? ` (line ${d.line})` : ''}. Click to see everything it drives.`}
                onClick={() => actions.revealScript(d.core, d.name)}
              >
                <i class="sw solid" />
                <span class="what mono">{d.name}.js</span>
                <span class="mk">script</span>
              </button>
            ))}
            {mine.length === 0 && auto.length === 0 && others.length === 0 && scripts.length === 0 && <div class="kline none">nothing drives it yet</div>}
          </div>
        );
      })}
    </div>
  );
}

/** One of your keys on an input: the key, what it does in a few words, who it drives, and "more" for the rest. */
function KeyLine({
  m,
  channel,
  scopes,
  open,
  onOpen,
  waiting,
  refused,
  capProps,
  onScope,
  onHover,
  onPatch,
  onDrag,
  onRemove,
}: {
  m: InputBinding;
  channel: { min: number; max: number };
  scopes: Scope[];
  open: boolean;
  onOpen(): void;
  waiting: boolean;
  refused: string | undefined;
  capProps: { 'data-waitcap': string; onClick(): void };
  onScope(target: string): void;
  onHover(target: string | undefined): void;
  onPatch(patch: Partial<Binding>): void;
  onDrag(on: boolean): void;
  onRemove(): void;
}) {
  const b = m.binding;
  const mode = b.mode as InputMode;
  const value = b.value ?? fullValue(channel);
  return (
    <div class={`kline yours${open ? ' open' : ''}`}>
      <div class="kl-top">
        <button type="button" class={`cap small${waiting ? ' wait' : ''}`} title={waiting ? 'Press the new key. Esc, or a click here, calls it off.' : 'Your key. Click, then press another to change it.'} {...capProps}>
          {waiting ? '...' : keyLabel(b.key)}
        </button>
        <span class="what">
          {MODE_WORDS[mode]}, {valueWords(value, channel)}
        </span>
        <button type="button" class="more-btn" aria-expanded={open} onClick={onOpen} title="How the key works, how much, and remove">
          more {open ? '▾' : '▸'}
        </button>
      </div>
      {refused !== undefined && <p class="warn-text small">{refused}</p>}
      <div class="kl-who">
        <span class="lbl">drives</span>
        <Segmented
          options={scopes.map((s) => ({ value: s.target, label: s.label, title: s.kind === 'group' ? `Every part in the group "${s.label}"` : s.kind === 'kind' ? 'Every part of this kind on the robot' : 'Only this one part' }))}
          value={m.scope.target}
          onChange={onScope}
          onHover={onHover}
          label="who it drives"
        />
      </div>
      {open && (
        <div class="kl-more">
          <Segmented options={INPUT_MODES.map((x) => ({ value: x, label: MODE_WORDS[x], title: MODE_HELP[x] }))} value={mode} onChange={(x) => onPatch({ mode: x })} label="how the key works" />
          <div class="val" title={`How much it drives the input: ${valueWords(channel.min, channel)} to ${valueWords(channel.max, channel)}`}>
            <span class="lbl">how much</span>
            <Slider value={Math.round(value * 100)} min={channel.min * 100} max={channel.max * 100} step={5} label="how much" onDrag={onDrag} onChange={(v) => onPatch({ value: Math.min(channel.max, Math.max(channel.min, v / 100)) })} />
            <b>{valueWords(value, channel)}</b>
          </div>
          <Button small kind="danger" onClick={onRemove} title="Remove this key from the input">
            Remove key
          </Button>
        </div>
      )}
    </div>
  );
}
