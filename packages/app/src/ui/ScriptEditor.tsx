import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ParamSpec, ScriptError } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export type ScriptCheck = { ok: true; params: Record<string, ParamSpec> } | { ok: false; error: ScriptError };

export interface ScriptEditorActions {
  setScriptSource(id: string, source: string): void;
  setScriptParam(id: string, name: string, value: number | undefined): void;
  /** Compiles in the sandbox without running; undefined while the sandbox is still loading. */
  checkScript(source: string, name: string): ScriptCheck | undefined;
  closeScript(): void;
  /** Typing in the editor is one undo step per editing session. */
  beginTextEdit(): void;
  endTextEdit(): void;
}

/** The code editor (M5, textarea first per Q15), over the canvas. Tab indents; Esc leaves the text; errors show live. */
export function ScriptEditor({ store, actions }: { store: Store<AppState>; actions: ScriptEditorActions }) {
  const id = useStore(store, (s) => s.scriptEditor);
  // M7: the script of the core the panels are on.
  const spec = useStore(store, (s) => s.builder.controls.scripts.find((x) => x.id === s.scriptEditor));
  const [check, setCheck] = useState<ScriptCheck | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const source = typeof spec?.source === 'string' ? spec.source : undefined;
  const name = spec?.file ?? `${id ?? 'script'}.js`;

  useLayoutEffect(() => {
    area.current?.focus();
  }, [id]);

  useEffect(() => {
    if (source === undefined) return;
    const t = setTimeout(() => setCheck(actions.checkScript(source, name)), 250);
    return () => clearTimeout(t);
  }, [source, name]);

  if (!id || !spec) return null;
  const params = check?.ok ? Object.entries(check.params) : [];
  return (
    <div class="script-editor panel">
      <div class="script-editor-head">
        <strong>{name}</strong>
        <span class="muted small">script "{spec.id}" · saved with the blueprint</span>
        <span class="spacer" />
        <button onClick={actions.closeScript}>Done</button>
      </div>
      {source === undefined ? (
        <p class="refused">The file {name} was not found, so there is no code to edit.</p>
      ) : (
        <textarea
          ref={area}
          class="script-code"
          spellcheck={false}
          value={source}
          onFocus={actions.beginTextEdit}
          onBlur={actions.endTextEdit}
          onInput={(e) => actions.setScriptSource(spec.id, (e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            const el = e.target as HTMLTextAreaElement;
            if (e.key === 'Escape') {
              el.blur();
              return;
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const { selectionStart: a, selectionEnd: b, value } = el;
              const next = `${value.slice(0, a)}  ${value.slice(b)}`;
              actions.setScriptSource(spec.id, next);
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
        />
      )}
      <div class="script-status">
        {check === undefined ? (
          <span class="muted small">checking...</span>
        ) : check.ok ? (
          <span class="ok small">no errors</span>
        ) : (
          <span class="refused small">
            {check.error.kind}: {check.error.message}
          </span>
        )}
      </div>
      {params.length > 0 && (
        <div class="script-params">
          {params.map(([p, ps]) => (
            <label key={p} class="field small" title={`default ${ps.default}${ps.min !== undefined ? `, min ${ps.min}` : ''}${ps.max !== undefined ? `, max ${ps.max}` : ''}`}>
              <span>{p}</span>
              <input
                type="number"
                step="any"
                value={spec.params[p] ?? ps.default}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  actions.setScriptParam(spec.id, p, Number.isFinite(v) && v !== ps.default ? v : undefined);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
