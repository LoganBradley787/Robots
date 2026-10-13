import { useEffect, useState } from 'preact/hooks';
import type { Binding, BindingMode, PartRegistry } from '@robots/sim-core';
import { worldKeyLabel } from '../app/keys';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { autoSummary, bindingTargets, channelsForTarget, defaultBinding, keyName, percent, typeLabel } from '../builder/bindings';
import { ControlsFor } from './ControlsFor';
import type { BuilderActions } from './actions';
import { Button, Check, KeyCap, Select, Slider, type SelectOption } from './kit';

export interface BindingActions {
  setBindings(bindings: Binding[]): void;
  setAutoControls(on: boolean): void;
}

const MODES: BindingMode[] = ['hold', 'toggle', 'pulse', 'script'];
const MODE_OPTIONS: SelectOption[] = MODES.map((m) => ({ value: m, label: m }));

export function BindingsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BindingActions & Pick<BuilderActions, 'setControlsFor'> }) {
  const draft = useStore(store, (s) => s.builder.draft);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  // M7: the picked core's controls (the main core's are the blueprint's top level).
  const controls = useStore(store, (s) => s.builder.controls);
  const main = controls.core === undefined;
  const scope = controls.scope;
  const bindings = controls.bindings;
  const scripts = controls.scripts;
  const targets = bindingTargets(draft, registry, scope);
  const known = [...targets.types, ...targets.tags, ...targets.parts];
  const auto = main ? autoSummary(draft, registry) : [];
  const autoOn = controls.autoOn;
  const update = (i: number, patch: Partial<Binding>): void => {
    actions.setBindings(bindings.map((b, n) => (n === i ? { ...b, ...patch } : b)));
  };
  // The binding whose key is being picked: the next key pressed anywhere becomes its key.
  const [waiting, setWaiting] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (waiting === undefined) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setWaiting(undefined);
      if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
      const reserved = worldKeyLabel(e.code);
      if (reserved) return setRefused(`${reserved}, so it cannot drive the robot. Letters and digits are all yours.`);
      setRefused(undefined);
      update(waiting, { key: keyName(e) });
      setWaiting(undefined);
    };
    const away = (): void => setWaiting(undefined);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [waiting, bindings]);
  const targetOptions: SelectOption[] = [
    ...targets.types.map((t) => ({ value: t, label: typeLabel(registry, t), group: 'Kinds of part' })),
    ...targets.tags.map((t) => ({ value: t, label: t, group: 'Groups' })),
    ...targets.parts.map((t) => ({ value: t, label: t, group: 'Single parts' })),
  ];
  const retarget = (i: number, target: string): void => {
    const channels = channelsForTarget(draft, registry, target, scope);
    const current = bindings[i]?.channel;
    const keep = channels.find((c) => c.name === current) ?? channels[0];
    update(i, { target, channel: keep?.name ?? '', value: keep ? Math.min(keep.max, Math.max(keep.min, bindings[i]?.value ?? keep.max)) : 1 });
  };

  return (
    <div class="sec">
      <div class="h">Keys</div>
      <ControlsFor store={store} actions={actions} />
      {!main && <p class="dim small">These start when this core's piece breaks off (a decoupler fires, or a blast cuts it free).{scope !== undefined ? ` Targets mean ${scope}'s own parts.` : ''}</p>}
      <Check checked={autoOn} onChange={(on) => actions.setAutoControls(on)}>
        Auto keys
      </Check>
      {autoOn && auto.length > 0 && (
        <ul class="auto-lines">
          {auto.map((l) => (
            <li key={l.key}>
              <KeyCap small auto>
                {l.key}
              </KeyCap>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {!main && autoOn && <p class="dim small">Its piece's parts get auto keys when it wakes.</p>}
      {main && autoOn && auto.length === 0 && <p class="dim small">No parts with auto keys yet. Wheels drive on D and A; thrusters and propellers use the key they push toward; gyros spin on Q and E.</p>}
      <p class="dim small">Select a part to turn its auto keys off. Your own keys below add to the auto ones.</p>
      {bindings.map((b, i) => {
        const channels = channelsForTarget(draft, registry, b.target ?? '', scope);
        const ch = channels.find((c) => c.name === b.channel);
        const setMode = (mode: BindingMode): void => {
          if (mode === b.mode) return;
          if (mode === 'script') {
            actions.setBindings(bindings.map((x, n) => (n === i ? { key: x.key, mode, script: scripts[0]?.id ?? '' } : x)));
            return;
          }
          const d = defaultBinding(draft, registry, controls);
          const base = b.mode === 'script' ? { key: b.key, mode, target: d.target, channel: d.channel, value: d.value } : { ...b, mode };
          actions.setBindings(bindings.map((x, n) => (n === i ? base : x)));
        };
        const missing = b.target !== undefined && !known.includes(b.target);
        return (
          <div class="binding" key={i}>
            <button type="button" class={`cap${waiting === i ? ' wait' : ''}`} title="click, then press a key" onClick={() => setWaiting(waiting === i ? undefined : i)}>
              {waiting === i ? '...' : b.key.length === 1 ? b.key.toUpperCase() : b.key}
            </button>
            <Select value={b.mode} options={MODE_OPTIONS} onChange={(m) => setMode(m as BindingMode)} label="mode" />
            {b.mode === 'script' ? (
              <Select value={b.script} options={scripts.map((s) => ({ value: s.id, label: `script ${s.id}` }))} placeholder="(add a script first)" title="the script this key turns on and off" onChange={(script) => update(i, { script })} />
            ) : (
              <Select value={b.target} options={targetOptions} placeholder={missing ? `${b.target} (missing)` : '(nothing to drive)'} onChange={(t) => retarget(i, t)} label="what it drives" />
            )}
            <button type="button" class="x" aria-label="remove this key" title="Remove" onClick={() => actions.setBindings(bindings.filter((_, n) => n !== i))}>
              &#10005;
            </button>
            {b.mode !== 'script' && (
              <>
                <span />
                <Select value={b.channel} options={channels.map((c) => ({ value: c.name, label: c.name }))} placeholder={b.channel || '(no inputs)'} onChange={(channel) => update(i, { channel })} label="input" />
                <div class="val" title={ch ? `${percent(ch.min)} to ${percent(ch.max)}: +100% is full forward or full throttle` : ''}>
                  <Slider
                    value={Math.round((b.value ?? 0) * 100)}
                    min={ch ? ch.min * 100 : -100}
                    max={ch ? ch.max * 100 : 100}
                    step={5}
                    label="how much"
                    onChange={(v) => update(i, { value: ch ? Math.min(ch.max, Math.max(ch.min, v / 100)) : v / 100 })}
                  />
                  <b>{percent(b.value ?? 0)}</b>
                </div>
              </>
            )}
          </div>
        );
      })}
      {refused && <p class="warn-text small">{refused}</p>}
      <Button onClick={() => actions.setBindings([...bindings, defaultBinding(draft, registry, controls)])} disabled={known.length === 0}>
        Add a key
      </Button>
    </div>
  );
}
