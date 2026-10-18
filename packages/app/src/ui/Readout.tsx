import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export interface ReadoutActions {
  /** Opens or folds the live readout. Folded, the world keeps no trace. */
  setReadout(open: boolean): void;
}

/**
 * The live readout (M16), in the world, for the robot you control or watch: each script running, off or crashed with
 * the message and line, the keys it reads, its last log lines and what it set this tick; for each input a key or a
 * script drives, who is driving it right now ("W is held: the key's 100% beats hover's 54%"); and each held key a
 * script reads ("W is held: hover reads it"). Nothing here can be changed: settings are set in the builder. It folds to
 * a small tab, which still says when a script has stopped.
 */
export function Readout({ store, actions }: { store: Store<AppState>; actions: ReadoutActions }) {
  const r = useStore(store, (s) => s.world?.readout);
  const open = useStore(store, (s) => s.world?.readoutOpen === true);
  if (!r) return null;
  const crashed = r.scripts.filter((s) => s.state === 'crashed');
  const on = r.scripts.filter((s) => s.state === 'on').length;
  if (!open) {
    return (
      <button type="button" class={`readout-tab plate${crashed.length > 0 ? ' bad' : ''}`} onClick={() => actions.setReadout(true)} title="Open the live readout: what this robot's scripts and keys are doing right now">
        <span class="h">Readout</span>
        {r.scripts.length === 0 ? (
          <span class="dim">no scripts</span>
        ) : crashed.length > 0 ? (
          <span class="stopped">
            <i class="dot crashed" />
            {crashed[0]?.id} stopped{crashed[0]?.line !== undefined ? ` at line ${crashed[0].line}` : ''}
            {crashed.length > 1 ? ` and ${crashed.length - 1} more` : ''}
          </span>
        ) : (
          <span>
            <i class={`dot ${on > 0 ? 'on' : 'off'}`} />
            {on} of {r.scripts.length} running
          </span>
        )}
        <span class="caret">&#9652;</span>
      </button>
    );
  }
  return (
    <div class="readout plate float">
      <div class="rhead">
        <span class="h">Readout</span>
        <span class="who">
          {r.watching ? 'watching' : 'controlling'} <b>{r.robot}</b>
        </span>
        <span class="gap" />
        <button type="button" class="x" aria-label="fold the readout" title="Fold it away" onClick={() => actions.setReadout(false)}>
          &#9662;
        </button>
      </div>
      <div class="rbody scroll">
        {r.scripts.length === 0 && r.inputs.length === 0 && <p class="dim">This robot has no scripts and no keys.</p>}
        {r.scripts.map((s) => (
          <div class={`rs ${s.state}`} key={s.id}>
            <div class="st">
              <i class={`dot ${s.state}`} />
              <b>{s.id}</b>
              <span class="state">{s.state === 'on' ? 'running' : s.state === 'off' ? 'off' : `stopped${s.line !== undefined ? ` at line ${s.line}` : ''}`}</span>
            </div>
            {s.error !== undefined && <div class="err">{s.error}</div>}
            {s.reads !== undefined && <div class="reads">{s.reads}</div>}
            {s.sets.length > 0 && (
              <div class="sets">
                <span class="lbl">set this tick</span>
                {s.sets.map((w, i) => (
                  <div key={i} class={w.bad ? 'bad' : ''}>
                    {w.text}
                  </div>
                ))}
              </div>
            )}
            {s.state === 'on' && s.sets.length === 0 && <div class="sets none">set nothing this tick</div>}
            {s.logs.map((l, i) => (
              <div class="log" key={i}>
                {l}
              </div>
            ))}
          </div>
        ))}
        {(r.inputs.length > 0 || r.held.length > 0) && (
          <div class="ri-list">
            <div class="h sub">Who drives what</div>
            {r.held.map((h) => (
              <div class="rin key" key={h}>
                <span class="says">{h}</span>
              </div>
            ))}
            {r.inputs.map((i, n) => (
              <div class={`rin ${i.source}`} key={n}>
                <span class="what">{i.what}</span>
                <span class="says">{i.says}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
