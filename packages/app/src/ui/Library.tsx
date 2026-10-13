import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { groupByKind, kindsOf } from '../builder/library';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Button } from './kit';
import { KindPicker } from './KindPicker';

/**
 * The library (M16; the Open button): every saved robot as a card with its picture, grouped by kind, with a search
 * box. Open one, or take a copy of it in hand to place inside the robot you are building. A card's kind label
 * changes its kind. Nothing is hidden.
 */
export function Library({ store, actions }: { store: Store<AppState>; actions: BuilderActions }) {
  const doc = useStore(store, (s) => s.doc);
  const meta = useStore(store, (s) => s.meta);
  const draftKind = useStore(store, (s) => s.builder.draft.kind);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const close = (): void => store.set((s) => ({ panel: { ...s.panel, overlay: undefined } }));
  useLayoutEffect(() => search.current?.focus(), []);
  useEffect(() => actions.needMeta(doc.files.map((f) => f.file)), [doc.files]);
  // The open robot shows the kind it has on screen, saved or not.
  const files = doc.files.map((f) => (f.file === doc.file ? { file: f.file, name: f.name, ...(draftKind !== undefined ? { kind: draftKind } : {}) } : f));
  const groups = groupByKind(files, query);
  const kinds = kindsOf(files, draftKind);
  const open = (file: string): void => {
    close();
    if (file !== doc.file) actions.open(file);
  };
  return (
    <div class="over lib" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div class="win plate" role="dialog" aria-label="Open a robot">
        <div class="edhead">
          <span class="h" style={{ fontSize: '15px' }}>
            Open a robot
          </span>
          <span class="gap" />
          <Button onClick={close} title="Close (Esc)">
            Close
          </Button>
        </div>
        <div class="search-row">
          <input
            ref={search}
            class="field"
            placeholder={`Search ${doc.files.length} robots`}
            aria-label="search robots"
            spellcheck={false}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              const first = groups[0]?.files[0];
              if (e.key === 'Enter' && first) open(first.file);
            }}
          />
        </div>
        <div class="scroll">
          {doc.files.length === 0 && <p class="empty">No saved robots yet. Save one and it shows up here.</p>}
          {doc.files.length > 0 && groups.length === 0 && <p class="empty">No robot matches "{query.trim()}".</p>}
          {groups.map((g) => (
            <div key={g.kind}>
              <div class="cat h">
                {g.kind} <span class="n">{g.files.length}</span>
              </div>
              <div class="cards">
                {g.files.map((f) => {
                  const m = meta[f.file];
                  const current = f.file === doc.file;
                  return (
                    <div key={f.file} class={`bp${current ? ' current' : ''}`}>
                      <button type="button" class="bp-open" title={current ? 'This is the robot you have open' : `Open ${f.name}`} onClick={() => open(f.file)}>
                        <div class="pic">{m?.thumb !== undefined && <img src={m.thumb} alt="" draggable={false} />}</div>
                        <div class="nm">{f.name}</div>
                      </button>
                      <div class="meta">
                        <span>{current ? 'open now' : m === undefined ? '\u00A0' : m.parts < 0 ? 'cannot be read' : `${m.parts} part${m.parts === 1 ? '' : 's'}${m.scripts > 0 ? `, ${m.scripts} script${m.scripts === 1 ? '' : 's'}` : ''}`}</span>
                        <KindPicker kind={f.kind} kinds={kinds} onPick={(k) => (current ? actions.setKind(k) : actions.setFileKind(f.file, k))} />
                      </div>
                      <div class="row">
                        <Button small onClick={() => open(f.file)} disabled={current}>
                          Open
                        </Button>
                        <Button
                          small
                          kind="ghost"
                          disabled={current}
                          title={current ? 'A robot cannot be placed inside itself' : 'Take a copy in hand to place inside the robot you are building'}
                          onClick={() => {
                            close();
                            actions.holdBlueprint(f.file);
                          }}
                        >
                          Place a copy
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
