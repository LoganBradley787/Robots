import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseBehaviorHeader, type ParamSpec, type PartRegistry, type ScriptError } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Button, NumberField } from './kit';
import { createCodeEditor, type CodeEditor } from './codeEditor';
import { completeAt, editorChecks, placeFix, type EditorCheck } from '../builder/scriptAssist';
import { apiSections, robotReference, type RefChannel, type RefTarget } from '../builder/scriptRef';

export type ScriptCheck = { ok: true; params: Record<string, ParamSpec> } | { ok: false; error: ScriptError };

export interface ScriptEditorActions {
  setScriptSource(id: string, source: string): void;
  setScriptParam(id: string, name: string, value: number | undefined): void;
  /** Compiles in the sandbox without running; undefined while the sandbox is still loading. */
  checkScript(source: string, name: string): ScriptCheck | undefined;
  closeScript(): void;
  /** Typing in the editor is one undo step per editing session (`code`); so is one drag of a slider (`drag`). */
  beginTextEdit(owner?: 'code' | 'drag'): void;
  endTextEdit(owner?: 'code' | 'drag'): void;
}

/**
 * What a part clicked on the board puts in the code: its id as a quoted string, or the bare id when the caret already
 * stands between a pair of quotes (`set("|", ...)`), so a click never makes `""id""`.
 */
export function partNameInsert(source: string, pos: number, id: string): string {
  const before = source[pos - 1];
  const after = source[pos];
  if ((before === '"' || before === "'") && after === before) return id;
  return JSON.stringify(id);
}

/**
 * The script view (M16): the code in the middle (CodeMirror: colours, marks in the margin, completion), with "This
 * robot" and "You can use" beside it, the checks under it, and the board still in view at its right. A click on a
 * part of the board puts its name in the code. Done goes back to where you were.
 */
export function ScriptEditor({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: ScriptEditorActions }) {
  const id = useStore(store, (s) => s.scriptEditor);
  // M7: the script of the core the panels are on.
  const spec = useStore(store, (s) => s.builder.controls.scripts.find((x) => x.id === s.scriptEditor));
  const draft = useStore(store, (s) => s.builder.draft);
  const core = useStore(store, (s) => s.builder.controlsFor);
  const scope = useStore(store, (s) => s.builder.controls.scope);
  const [check, setCheck] = useState<ScriptCheck | undefined>(undefined);
  const [checks, setChecks] = useState<EditorCheck[]>([]);
  const host = useRef<HTMLDivElement>(null);
  /** The text the checks in the list were worked out on: their offsets are into it. */
  const checkedFor = useRef<string | undefined>(undefined);
  const editor = useRef<CodeEditor | undefined>(undefined);
  const source = typeof spec?.source === 'string' ? spec.source : undefined;
  const name = spec?.file ?? `${id ?? 'script'}.js`;
  const ref = useMemo(() => robotReference(draft, registry, core), [draft, core]);
  const sections = useMemo(() => apiSections(ref, registry), [ref]);
  // The editor's hooks read the latest of everything through this, since the editor itself is made once.
  const live = useRef({ ref, id: spec?.id, actions });
  live.current = { ref, id: spec?.id, actions };

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || source === undefined) return;
    const ed = createCodeEditor(el, source, {
      onChange: (text) => {
        const now = live.current;
        if (now.id !== undefined) now.actions.setScriptSource(now.id, text);
      },
      onFocus: () => live.current.actions.beginTextEdit(),
      onBlur: () => live.current.actions.endTextEdit(),
      complete: (text, pos, inComment) => completeAt(text, pos, live.current.ref, registry, inComment),
    });
    editor.current = ed;
    ed.focus();
    return () => {
      // Leaving while the text has the focus still closes the one undo step it opened.
      live.current.actions.endTextEdit();
      editor.current = undefined;
      ed.destroy();
    };
  }, [source === undefined]);

  // The text changed from outside (an undo, a fix from Problems, an update from the shelf).
  // Read from the store itself, not from this render: while typing, a render can be a keystroke behind, and putting
  // its text back would take the newest character out again.
  useEffect(() => {
    const s = store.get();
    const latest = s.builder.controls.scripts.find((x) => x.id === s.scriptEditor)?.source;
    if (typeof latest === 'string') editor.current?.setText(latest);
  }, [source]);

  // A click on a problem asks for a line: scroll to it and select it.
  const jump = useStore(store, (s) => s.scriptLine);
  useEffect(() => {
    if (jump) editor.current?.showLine(jump.line);
  }, [jump?.seq]);

  // A part clicked on the board: its name goes in at the caret.
  const insert = useStore(store, (s) => s.scriptInsert);
  useEffect(() => {
    const ed = editor.current;
    if (!insert || !ed) return;
    const pos = ed.view.state.selection.main.from;
    ed.insert(partNameInsert(ed.view.state.doc.toString(), pos, insert.text));
  }, [insert?.seq]);

  // Checks as you type: what the sandbox says of the text, and the pure checks against this robot.
  useEffect(() => {
    if (source === undefined) return;
    const t = setTimeout(() => {
      const compiled = actions.checkScript(source, name);
      setCheck(compiled);
      const found = editorChecks(source, draft, registry, scope, compiled);
      checkedFor.current = source;
      setChecks(found);
      editor.current?.setChecks(found);
      // The list under the code may have grown or shrunk: the line being typed stays in view.
      requestAnimationFrame(() => editor.current?.keepCaretInView());
    }, 220);
    return () => clearTimeout(t);
  }, [source, name, draft, scope]);

  if (!id || !spec) return null;
  const header = source !== undefined ? parseBehaviorHeader(source).header : undefined;
  const params = check?.ok ? Object.entries(check.params) : [];
  const put = (c: RefChannel): void => editor.current?.insert(c.insert, c.caret);
  const errors = checks.filter((c) => c.severity === 'error').length;
  // A fix under the code is applied where its check is now: when the text changed since the check ran (a fix just
  // applied, a key typed), it is checked again first, and a fix whose check is gone does nothing.
  const applyFix = (c: EditorCheck, label: string): void => {
    const ed = editor.current;
    if (!ed) return;
    const now = ed.view.state.doc.toString();
    const change = placeFix(c, label, checkedFor.current, now, (text) => editorChecks(text, draft, registry, scope, actions.checkScript(text, name)));
    if (!change) return;
    ed.view.dispatch({ changes: change, userEvent: 'input' });
    ed.focus();
  };
  return (
    <div class="script-view plate" onContextMenu={(e) => e.preventDefault()}>
      <div class="sv-ref scroll">
        <div class="rgrp">
          <div class="h">
            This robot <span>click to put it in the code</span>
          </div>
          {ref.scope !== undefined && <p class="note">This script runs on {ref.scope}'s own core: these are its own parts and groups.</p>}
          {ref.groups.length + ref.kinds.length + ref.parts.length === 0 && <p class="note">Nothing here takes an input or reports anything yet. Place a part that does.</p>}
          <Targets title="Groups" list={ref.groups} put={put} />
          <Targets title="Kinds of part" list={ref.kinds} put={put} />
          <Targets title="Single parts" list={ref.parts} put={put} folded />
          <p class="note">
            <b>get</b> on a group or a kind reads the first matching part, not all of them.
          </p>
          <p class="note">
            A part that sees has no distance output. Read <b>contacts</b>: each one has a distance.
          </p>
          <p class="note">Click a part on the board to put its name in the code.</p>
        </div>
        <div class="rgrp">
          <div class="h">
            You can use <span>the whole list</span>
          </div>
          {sections.map((s) => (
            <div key={s.section} class={s.dim !== undefined ? 'dimmed' : ''}>
              <div class="rt">{s.section}</div>
              {s.dim !== undefined && <p class="why">Does nothing here: {s.dim}.</p>}
              {s.entries.map((e) => (
                <button type="button" class="api" key={e.name} title={e.more !== undefined ? `${e.about}. ${e.more}` : e.about} onClick={() => editor.current?.insert(e.insert, e.caret ?? 0)}>
                  <code>{e.sig}</code>
                  <span>{e.about}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div class="sv-mid">
        <div class="edhead">
          <span class="h" style={{ fontSize: '14px' }}>
            {name}
          </span>
          <span class="dim small sub">{header ? `behavior "${header.name}", this robot's own copy` : `script "${spec.id}", saved with the robot`}</span>
          <span class="gap" />
          <Button onClick={actions.closeScript} title="Back to the board">
            Done
          </Button>
        </div>
        {source === undefined ? <p class="bad-text pad">The file {name} was not found, so there is no code to edit.</p> : <div class="sv-code" ref={host} />}
        <div class={`sv-checks${checks.length === 0 ? ' ok' : ''}`}>
          {check === undefined && checks.length === 0 ? (
            <div class="line wait">
              <i />
              <span class="dim">checking...</span>
            </div>
          ) : checks.length === 0 ? (
            <div class="line">
              <i />
              <span>No problems. Every name and input here exists on this robot.</span>
            </div>
          ) : (
            <>
              <div class="sum">
                {errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : ''}
                {errors > 0 && checks.length > errors ? ', ' : ''}
                {checks.length > errors ? `${checks.length - errors} warning${checks.length - errors === 1 ? '' : 's'}` : ''}
              </div>
              {checks.map((c, i) => (
                <div class={`line ${c.severity}`} key={i}>
                  <i />
                  <button type="button" class="linkish where" onClick={() => editor.current?.showRange(c.from, c.to)} title="Show it in the code">
                    line {c.line}
                  </button>
                  <span class="msg">{c.message}</span>
                  {c.fixes.slice(0, 2).map((f) => (
                    <Button
                      small
                      key={f.label}
                      title={`Write ${f.text} there`}
                      onClick={() => applyFix(c, f.label)}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
        {params.length > 0 && (
          <div class="script-params">
            {params.map(([p, ps]) => (
              <label key={p} title={`default ${ps.default}${ps.min !== undefined ? `, min ${ps.min}` : ''}${ps.max !== undefined ? `, max ${ps.max}` : ''}. Its card in the Behaviors tab has a slider.`}>
                <span>{p}</span>
                <NumberField value={spec.params[p] ?? ps.default} label={p} onChange={(v) => actions.setScriptParam(spec.id, p, v !== ps.default ? v : undefined)} />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A section of "This robot": each name with its inputs and what it reports, every one a click that writes the call. */
function Targets({ title, list, put, folded }: { title: string; list: RefTarget[]; put(c: RefChannel): void; folded?: boolean }) {
  const [open, setOpen] = useState(!folded);
  if (list.length === 0) return null;
  return (
    <>
      <button type="button" class="rt fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title} <span class="n">{list.length}</span>
        <span class="caret">{open ? '▾' : '▸'}</span>
      </button>
      {open &&
        list.map((t) => (
          <div class="tgt" key={`${t.kind}:${t.name}`}>
            <div class="tn">
              <code>{t.name}</code>
              <span>{t.kind === 'part' ? t.what : t.kind === 'kind' && t.count === 1 ? '1 part' : t.what}</span>
            </div>
            {t.inputs.map((c) => (
              <button type="button" class="ri" key={`i${c.name}`} onClick={() => put(c)} title={`Writes ${c.insert.replace(', )', ', value)')} at the caret${c.on !== undefined ? `. ${c.on} of the ${t.count} parts have it` : ''}`}>
                <span class="io in">in</span>
                <span class="cn">{c.name}</span>
                <em>
                  {c.range}
                  {c.words !== '' ? `: ${c.words}` : ''}
                </em>
              </button>
            ))}
            {t.outputs.map((c) => (
              <button type="button" class="ri" key={`o${c.name}`} onClick={() => put(c)} title={`Writes ${c.insert} at the caret${t.count > 1 ? '. It reads the first matching part' : ''}`}>
                <span class="io out">out</span>
                <span class="cn">{c.name}</span>
                <em>
                  {c.range}
                  {t.count > 1 ? ', first part' : ''}
                </em>
              </button>
            ))}
          </div>
        ))}
    </>
  );
}
