import { useMemo, useState } from 'preact/hooks';
import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { issueLine, problemLine, safeFix } from '../builder/problemText';
import { Button } from './kit';

/** Once the row a click opened has grown, the strip scrolls so all of it shows (its buttons are at the bottom). */
function intoView(e: MouseEvent): void {
  const el = (e.currentTarget as HTMLElement | null)?.parentElement;
  requestAnimationFrame(() => el?.scrollIntoView({ block: 'nearest' }));
}

/**
 * Problems (M16): the validator's list and the names in scripts that reach nothing, pinned to the bottom of the right
 * panel on every tab. The top strip's pill opens and closes it. Each problem is one short line (who, what); a click
 * opens it to the full message and what can be done about it, and shows the part or the cell it is about. The strip
 * never takes more than about a quarter of the panel: a long list scrolls inside it.
 *
 * A dead name carries "point it at X" only when X is a near-misspelling of it (`safeFix`); otherwise the one offer is
 * to open the script at that line.
 */
export function Problems({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: Pick<BuilderActions, 'focusIssue' | 'openProblem' | 'fixName'> }) {
  const issues = useStore(store, (s) => s.builder.issues);
  const scripts = useStore(store, (s) => s.builder.scriptProblems);
  const draft = useStore(store, (s) => s.builder.draft);
  const open = useStore(store, (s) => s.panel.problemsOpen);
  // The one row that is open, by its place in the list and its text (so a list that changed closes it).
  const [row, setRow] = useState<string | undefined>(undefined);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const count = issues.length + scripts.length;
  const toggle = (): void => store.set((s) => ({ panel: { ...s.panel, problemsOpen: !s.panel.problemsOpen } }));
  // Problems first: they stop Test. Warnings do not.
  const ordered = [...issues.filter((i) => i.severity === 'error'), ...issues.filter((i) => i.severity !== 'error')];
  const fixes = useMemo(() => scripts.map((p) => safeFix(p, draft, registry)), [scripts, draft]);
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
          {ordered.map((i, n) => {
            const id = `i${n}:${i.message}`;
            const isOpen = row === id;
            const where = i.partId !== undefined || i.cell !== undefined;
            return (
              <div key={id} class={`prob${i.severity === 'error' ? ' err' : ''}${isOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  class="prob-line"
                  aria-expanded={isOpen}
                  title={isOpen ? 'Click to close' : where ? 'Click for the whole message, and to see where' : 'Click for the whole message'}
                  onClick={(e) => {
                    setRow(isOpen ? undefined : id);
                    if (isOpen) return;
                    actions.focusIssue(i);
                    intoView(e);
                  }}
                >
                  <span class="txt">{issueLine(i.message)}</span>
                  <span class="code">{i.code}</span>
                </button>
                {isOpen && (
                  <div class="prob-body">
                    <p>{i.message}</p>
                    {where && (
                      <div class="row">
                        <Button small kind="ghost" onClick={() => actions.focusIssue(i)} title="Selects the part, or moves the board to the cell">
                          Show where
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {scripts.map((p, n) => {
            const id = `s${n}:${p.message}`;
            const isOpen = row === id;
            const fix = fixes[n];
            return (
              <div key={id} class={`prob script${isOpen ? ' open' : ''}`}>
                <button type="button" class="prob-line" aria-expanded={isOpen} title={isOpen ? 'Click to close' : 'Click for the whole message and what can be done'} onClick={(e) => {
                    setRow(isOpen ? undefined : id);
                    if (!isOpen) intoView(e);
                  }}>
                  <span class="txt">{problemLine(p)}</span>
                  <span class="code">{p.code}</span>
                </button>
                {isOpen && (
                  <div class="prob-body">
                    <p>{p.message}</p>
                    {fix && (
                      <div class="fix">
                        <code class="was">{fix.before}</code>
                        <code class="now">{fix.after}</code>
                      </div>
                    )}
                    {!p.open && <p class="dim">This script is inside something a bay builds: open that robot to edit it.</p>}
                    <div class="row">
                      {fix && (
                        <Button small onClick={() => actions.fixName(fix)} title={`Rewrites only the quoted name '${fix.from}' at that place${fix.spots.length > 1 ? `, in ${fix.spots.length} places` : ''}. One undo step.`}>
                          Point it at {fix.to}
                        </Button>
                      )}
                      {p.open && (
                        <Button small kind={fix ? 'ghost' : undefined} onClick={() => actions.openProblem(p)} title="Opens the script at that line">
                          Open the script
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
