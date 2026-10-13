import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Button } from './kit';

/**
 * Problems (M16): the validator's list and the names in scripts that reach nothing, pinned to the bottom of the right
 * panel on every tab. The top strip's pill opens and closes it. A click on one shows the part, or the line of the
 * script, it is about. A dead name with a real name close to it carries its fix: the line as it is and as it would be.
 */
export function Problems({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'focusIssue' | 'openProblem' | 'fixName'> }) {
  const issues = useStore(store, (s) => s.builder.issues);
  const scripts = useStore(store, (s) => s.builder.scriptProblems);
  const open = useStore(store, (s) => s.panel.problemsOpen);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const count = issues.length + scripts.length;
  const toggle = (): void => store.set((s) => ({ panel: { ...s.panel, problemsOpen: !s.panel.problemsOpen } }));
  return (
    <div class="probs">
      <button type="button" class="probs-head" aria-expanded={open} onClick={toggle} title={open ? 'Hide the list' : 'Show the list'}>
        <span>Problems</span>
        {count === 0 ? <span class="count ok">none</span> : <span class={`count ${errors > 0 ? 'err' : ''}`}>{count}</span>}
        <span class="caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div class="probs-list">
          {count === 0 && <p class="dim small">Nothing wrong. Ready to test.</p>}
          {/* Problems first: they stop Test. Warnings do not. */}
          {[...issues.filter((i) => i.severity === 'error'), ...issues.filter((i) => i.severity !== 'error')].map((i, n) => (
            <button type="button" key={n} class={`issue ${i.severity === 'error' ? 'err' : ''}`} onClick={() => actions.focusIssue(i)} title={i.partId !== undefined || i.cell !== undefined ? 'Click to see where' : undefined}>
              {i.message}
              <span class="code">{i.code}</span>
            </button>
          ))}
          {scripts.map((p, n) => (
            <div key={`s${n}`} class="issue script">
              <button type="button" class="linkish msg" disabled={!p.open} onClick={() => actions.openProblem(p)} title={p.open ? 'Click to open the script at that line' : 'This script is inside something a bay builds: open that robot to edit it'}>
                {p.message}
              </button>
              {p.fix && (
                <div class="fix">
                  <code class="was">{p.fix.before}</code>
                  <code class="now">{p.fix.after}</code>
                  <div class="row">
                    <Button small onClick={() => p.fix && actions.fixName(p.fix)} title={`Rewrites only the quoted name '${p.fix.from}' at that place${p.fix.spots.length > 1 ? `, in ${p.fix.spots.length} places` : ''}. One undo step.`}>
                      Point it at {p.fix.to}
                    </Button>
                    {p.open && (
                      <Button small kind="ghost" onClick={() => actions.openProblem(p)}>
                        Open the script
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <span class="code">{p.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
