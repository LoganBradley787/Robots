import { useState } from 'preact/hooks';
import type { Binding, BindingMode, PartRegistry } from '@robots/sim-core';
import { worldKeyLabel } from '../app/keys';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { autoSummary, bindingTargets, channelsForTarget, defaultBinding, keyName, percent, typeLabel } from '../builder/bindings';

export interface BindingActions {
  setBindings(bindings: Binding[]): void;
  setAutoControls(on: boolean): void;
}

const MODES: BindingMode[] = ['hold', 'toggle', 'pulse'];

export function BindingsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BindingActions }) {
  const draft = useStore(store, (s) => s.builder.draft);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const bindings = draft.bindings;
  const targets = bindingTargets(draft, registry);
  const known = [...targets.types, ...targets.tags, ...targets.parts];
  const auto = autoSummary(draft, registry);
  const autoOn = draft.autoControls !== false;
  const update = (i: number, patch: Partial<Binding>): void => {
    actions.setBindings(bindings.map((b, n) => (n === i ? { ...b, ...patch } : b)));
  };
  const retarget = (i: number, target: string): void => {
    const channels = channelsForTarget(draft, registry, target);
    const current = bindings[i]?.channel;
    const keep = channels.find((c) => c.name === current) ?? channels[0];
    update(i, { target, channel: keep?.name ?? '', value: keep ? Math.min(keep.max, Math.max(keep.min, bindings[i]?.value ?? keep.max)) : 1 });
  };

  return (
    <section class="side-section">
      <h3>Controls</h3>
      <label class="check">
        <input type="checkbox" checked={autoOn} onChange={(e) => actions.setAutoControls((e.target as HTMLInputElement).checked)} />
        <span>Auto controls</span>
      </label>
      {autoOn && auto.length > 0 && (
        <ul class="auto-lines">
          {auto.map((l) => (
            <li key={l.key}>
              <kbd>{l.key}</kbd> {l.text}
            </li>
          ))}
        </ul>
      )}
      {autoOn && auto.length === 0 && <p class="muted small">No parts with auto controls yet. Wheels drive on D and A; thrusters and propellers use the key they push toward; gyros spin on Q and E.</p>}
      <p class="muted small">Right-click a part to turn its auto controls off. Custom controls below add to the auto ones.</p>
      {bindings.map((b, i) => {
        const channels = channelsForTarget(draft, registry, b.target ?? '');
        const ch = channels.find((c) => c.name === b.channel);
        if (b.mode === 'script') return null;
        return (
          <div class="binding" key={i}>
            <input
              class="key"
              readOnly
              value={b.key}
              title="click, then press a key"
              onKeyDown={(e) => {
                if (e.key === 'Tab' || e.key === 'Escape') return;
                e.preventDefault();
                const reserved = worldKeyLabel(e.code);
                if (reserved) {
                  setRefused(`${reserved}, so it cannot drive the robot. Letters and digits are all yours.`);
                  return;
                }
                setRefused(undefined);
                update(i, { key: keyName(e) });
                (e.target as HTMLInputElement).blur();
              }}
            />
            <select class="mode" value={b.mode} onChange={(e) => update(i, { mode: (e.target as HTMLSelectElement).value as BindingMode })}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select class="target" value={b.target} onChange={(e) => retarget(i, (e.target as HTMLSelectElement).value)}>
              {b.target !== undefined && !known.includes(b.target) && <option value={b.target}>{b.target} (missing)</option>}
              {targets.types.length > 0 && (
                <optgroup label="Part types">
                  {targets.types.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(registry, t)}
                    </option>
                  ))}
                </optgroup>
              )}
              {targets.tags.length > 0 && (
                <optgroup label="Tags">
                  {targets.tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              )}
              {targets.parts.length > 0 && (
                <optgroup label="Single parts">
                  {targets.parts.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select class="channel" value={b.channel} onChange={(e) => update(i, { channel: (e.target as HTMLSelectElement).value })}>
              {channels.length === 0 && <option value={b.channel}>{b.channel || '(no channels)'}</option>}
              {channels.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              class="value"
              type="number"
              step="10"
              min={ch ? ch.min * 100 : undefined}
              max={ch ? ch.max * 100 : undefined}
              value={Math.round((b.value ?? 0) * 100)}
              title={ch ? `${percent(ch.min)} to ${percent(ch.max)}: +100% is full forward or full throttle` : ''}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value) / 100;
                if (Number.isFinite(v)) update(i, { value: ch ? Math.min(ch.max, Math.max(ch.min, v)) : v });
              }}
            />
            <span class="unit">%</span>
            <button class="tag-remove remove" aria-label="remove binding" onClick={() => actions.setBindings(bindings.filter((_, n) => n !== i))}>
              ×
            </button>
          </div>
        );
      })}
      {refused && <p class="refused small">{refused}</p>}
      <button onClick={() => actions.setBindings([...bindings, defaultBinding(draft, registry)])} disabled={known.length === 0}>
        Add control
      </button>
    </section>
  );
}
