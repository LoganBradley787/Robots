import type { Binding, BindingMode, PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { bindingTargets, channelsForTarget, defaultBinding, keyName } from '../builder/bindings';

export interface BindingActions {
  setBindings(bindings: Binding[]): void;
}

const MODES: BindingMode[] = ['hold', 'toggle', 'pulse'];

export function BindingsPanel({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BindingActions }) {
  const draft = useStore(store, (s) => s.builder.draft);
  const bindings = draft.bindings;
  const targets = bindingTargets(draft, registry);
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
      <p class="muted small">Keys do nothing until M3 (driving). Set them up now; they are saved with the blueprint.</p>
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
              {b.target !== undefined && !targets.tags.includes(b.target) && !targets.parts.includes(b.target) && <option value={b.target}>{b.target} (missing)</option>}
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
              step="0.1"
              min={ch?.min}
              max={ch?.max}
              value={b.value}
              title={ch ? `${ch.min} to ${ch.max}` : ''}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(v)) update(i, { value: ch ? Math.min(ch.max, Math.max(ch.min, v)) : v });
              }}
            />
            <button class="tag-remove remove" aria-label="remove binding" onClick={() => actions.setBindings(bindings.filter((_, n) => n !== i))}>
              ×
            </button>
          </div>
        );
      })}
      <button onClick={() => actions.setBindings([...bindings, defaultBinding(draft, registry)])} disabled={targets.tags.length + targets.parts.length === 0}>
        Add control
      </button>
    </section>
  );
}
