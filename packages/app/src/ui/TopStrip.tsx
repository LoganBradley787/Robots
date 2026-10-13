import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Button, Menu } from './kit';

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
 * The strip across the top (M16): the robot's name and file state at the left, then the file buttons, Undo and Redo;
 * at the right what the validator says, Script, and the one yellow button, Test.
 */
export function TopStrip({ store, actions }: { store: Store<AppState>; actions: BuilderActions }) {
  const doc = useStore(store, (s) => s.doc);
  const canUndo = useStore(store, (s) => s.builder.canUndo);
  const canRedo = useStore(store, (s) => s.builder.canRedo);
  const issues = useStore(store, (s) => s.builder.issues);
  const scriptOpen = useStore(store, (s) => s.scriptEditor !== undefined);
  const status = statusOf(issues);
  return (
    <div class="top plate">
      <Name name={doc.name} onRename={actions.rename} />
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
      <Menu
        label="..."
        title="New, Save As, Delete file"
        items={[
          { label: 'New robot', onPick: actions.newBlank },
          { label: 'Save As...', hint: 'Cmd+Shift+S', onPick: actions.saveAs },
          'sep',
          { label: 'Delete file', onPick: actions.remove, disabled: doc.file === undefined, danger: true, title: 'Removes the file. What is on screen stays.' },
        ]}
      />
      <Button onClick={() => store.set((s) => ({ panel: { ...s.panel, overlay: 'library' } }))} title="Open a saved robot">
        Open
      </Button>
      <Button onClick={actions.save} title="Save (Cmd+S)">
        Save
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
      <Button kind="go" onClick={actions.deploy} title="Try it in the world (Tab switches back and forth)">
        Test &#9654;
      </Button>
    </div>
  );
}
