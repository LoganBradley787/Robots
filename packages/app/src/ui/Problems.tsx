import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';

/**
 * Problems (M16): the validator's list, pinned to the bottom of the right panel on every tab. The top strip's pill
 * opens and closes it. A click on one shows the part it is about.
 */
export function Problems({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'focusIssue'> }) {
  const issues = useStore(store, (s) => s.builder.issues);
  const open = useStore(store, (s) => s.panel.problemsOpen);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const toggle = (): void => store.set((s) => ({ panel: { ...s.panel, problemsOpen: !s.panel.problemsOpen } }));
  return (
    <div class="probs">
      <button type="button" class="probs-head" aria-expanded={open} onClick={toggle} title={open ? 'Hide the list' : 'Show the list'}>
        <span>Problems</span>
        {issues.length === 0 ? <span class="count ok">none</span> : <span class={`count ${errors > 0 ? 'err' : ''}`}>{issues.length}</span>}
        <span class="caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div class="probs-list">
          {issues.length === 0 && <p class="dim small">Nothing wrong. Ready to test.</p>}
          {/* Problems first: they stop Test. Warnings do not. */}
          {[...issues.filter((i) => i.severity === 'error'), ...issues.filter((i) => i.severity !== 'error')].map((i, n) => (
            <button type="button" key={n} class={`issue ${i.severity === 'error' ? 'err' : ''}`} onClick={() => actions.focusIssue(i)} title={i.partId !== undefined || i.cell !== undefined ? 'Click to see where' : undefined}>
              {i.message}
              <span class="code">{i.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
