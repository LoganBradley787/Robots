import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Button, Popover } from './kit';
import { TEST_BOX, testBoxKey, type TestChoice } from '../builder/deployFlow';
import { useEffect } from 'preact/hooks';
import { KindPicker } from './KindPicker';
import { kindsOf } from '../builder/library';

/** "ready", "2 warnings", "1 problem": what the validator says, in a word. A problem stops Test; a warning does not. */
export function statusOf(issues: ReadonlyArray<{ severity: 'error' | 'warning' }>): { text: string; level: 'ok' | 'warn' | 'err' } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (errors > 0) return { text: `${errors} problem${errors === 1 ? '' : 's'}`, level: 'err' };
  if (issues.length > 0) return { text: `${issues.length} warning${issues.length === 1 ? '' : 's'}`, level: 'warn' };
  return { text: 'ready', level: 'ok' };
}

/** The robot's name: click it to type a new one. Enter keeps it, Esc does not. */
function Name({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  if (!editing)
    return (
      <button type="button" class="name h" title="Click to rename" onClick={() => setEditing(true)}>
        {name}
      </button>
    );
  const done = (keep: boolean): void => {
    const v = input.current?.value.trim() ?? '';
    setEditing(false);
    if (keep && v !== '' && v !== name) onRename(v);
  };
  return (
    <input
      ref={input}
      class="field name-field"
      defaultValue={name}
      aria-label="robot name"
      spellcheck={false}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') done(false);
      }}
    />
  );
}

/**
/**
 * The small box at the Test button (M16), when the robot has unsaved changes: "Not saved." and three choices. Enter
 * means Test anyway and never saves, whichever button has the focus; Esc and a click elsewhere mean Cancel.
 */
function TestBox({ anchor, onChoose }: { anchor: { current: HTMLSpanElement | null }; onChoose(choice: TestChoice): void }) {
  const first = useRef<HTMLDivElement>(null);
  // The box is placed and shown a frame after it is made, and the click that opened it lets go of the Test button
  // after that: only then can the focus go where Enter is headed.
  useEffect(() => {
    const t = setTimeout(() => first.current?.querySelector<HTMLButtonElement>('button[data-choice="anyway"]')?.focus(), 30);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    // Before anything else hears the key: the builder's own keys, and a focused button's own Enter.
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey) return;
      e.stopPropagation();
      // Tab still walks the three buttons.
      if (e.key === 'Tab') return;
      const choice = testBoxKey(e.key);
      // Space presses the button that has the focus, as on any button.
      if (choice === undefined && e.key === ' ' && (e.target as HTMLElement | null)?.closest('.test-box')) return;
      e.preventDefault();
      if (choice !== undefined) onChoose(choice);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <Popover anchor={anchor} onClose={() => onChoose('cancel')} align="right" class="test-box">
      <div ref={first} role="dialog" aria-label="This robot is not saved">
        <p class="said">
          <i />
          {TEST_BOX.text}
        </p>
        <div class="choices">
          {TEST_BOX.choices.map((c) => (
            <button type="button" key={c.value} data-choice={c.value} class={`btn${c.value === 'anyway' ? ' go' : c.value === 'cancel' ? ' ghost' : ''}`} title={c.title} onClick={() => onChoose(c.value)}>
              {c.label}
              {c.value === 'anyway' && <kbd>Enter</kbd>}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

/**
 * The strip across the top (M16): the robot's name and file state at the left, then the file buttons (New, Open,
 * Save, Save as, Delete), Undo and Redo; at the right what the validator says, Script, and the one yellow button, Test.
 */
export function TopStrip({ store, actions }: { store: Store<AppState>; actions: BuilderActions }) {
  const testBox = useStore(store, (s) => s.testBox === true);
  const testAnchor = useRef<HTMLSpanElement>(null);
  const doc = useStore(store, (s) => s.doc);
  const canUndo = useStore(store, (s) => s.builder.canUndo);
  const canRedo = useStore(store, (s) => s.builder.canRedo);
  const issues = useStore(store, (s) => s.builder.issues);
  const scriptOpen = useStore(store, (s) => s.scriptEditor !== undefined);
  const kind = useStore(store, (s) => s.builder.draft.kind);
  // A name in a script that reaches nothing is a warning too.
  const scriptProblems = useStore(store, (s) => s.builder.scriptProblems.length);
  const status = statusOf([...issues, ...Array.from({ length: scriptProblems }, () => ({ severity: 'warning' as const }))]);
  return (
    <div class="top plate">
      <Name name={doc.name} onRename={actions.rename} />
      <KindPicker kind={kind} kinds={kindsOf(doc.files, kind)} onPick={actions.setKind} />
      <span class="state" title={doc.file === undefined ? 'This robot has no file yet. Save writes one.' : `blueprints/${doc.file}`}>
        {doc.dirty || doc.file === undefined ? (
          <>
            <i />
            not saved
          </>
        ) : (
          'saved'
        )}
      </span>
      <Button onClick={actions.newBlank} title="Start a new robot. Unsaved changes are asked about first.">
        New
      </Button>
      <Button onClick={() => store.set((s) => ({ panel: { ...s.panel, overlay: 'library' } }))} title="Open a saved robot">
        Open
      </Button>
      <Button onClick={actions.save} title="Save (Cmd+S)">
        Save
      </Button>
      <Button onClick={actions.saveAs} title="Save as a new file; the open one stays as it was (Cmd+Shift+S)">
        Save as
      </Button>
      <Button kind="danger" onClick={actions.remove} disabled={doc.file === undefined} title={doc.file === undefined ? 'This robot has no file to delete' : 'Removes the file. It asks first. What is on screen stays.'}>
        Delete
      </Button>
      <span class="sep" />
      <Button kind="ghost" onClick={actions.undo} disabled={!canUndo} title="Undo (Cmd+Z)">
        Undo
      </Button>
      <Button kind="ghost" onClick={actions.redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
        Redo
      </Button>
      <span class="gap" />
      <button
        type="button"
        class={`pill ${status.level === 'ok' ? '' : status.level}`}
        title={status.level === 'err' ? 'Problems stop Test. Click to see them.' : 'What the checker says about this robot. Click to see the list.'}
        onClick={() => store.set((s) => ({ panel: { ...s.panel, problemsOpen: !s.panel.problemsOpen } }))}
      >
        <i />
        {status.text}
      </button>
      <Button on={scriptOpen} onClick={actions.script} title="This robot's scripts">
        Script
      </Button>
      <span ref={testAnchor} style={{ display: 'inline-flex' }}>
        <Button kind="go" onClick={actions.deploy} on={testBox} title="Try it in the world (Tab switches back and forth)">
          Test &#9654;
        </Button>
      </span>
      {testBox && <TestBox anchor={testAnchor} onChoose={actions.testChoice} />}
    </div>
  );
}
