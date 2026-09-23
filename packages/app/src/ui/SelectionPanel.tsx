import { useState } from 'preact/hooks';
import type { Blueprint, PartDef } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export interface SelectionActions {
  addTag(ids: string[], tag: string): void;
  removeTag(ids: string[], tag: string): void;
  rotate(dir: 1 | -1): void;
  deleteSelection(): void;
}

/** Explicit tags (not the implicit id tag) of the selected parts, with how many parts carry each. */
function tagCounts(bp: Blueprint, ids: string[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of bp.parts) {
    if (!ids.includes(p.id)) continue;
    for (const t of p.tags) if (t !== p.id) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count }));
}

function allTags(bp: Blueprint): string[] {
  const tags = new Set<string>();
  for (const p of bp.parts) for (const t of p.tags) if (t !== p.id) tags.add(t);
  return [...tags].sort();
}

export function SelectionPanel({ store, defs, actions }: { store: Store<AppState>; defs: PartDef[]; actions: SelectionActions }) {
  const selection = useStore(store, (s) => s.builder.selection);
  const draft = useStore(store, (s) => s.builder.draft);
  const [text, setText] = useState('');
  const parts = draft.parts.filter((p) => selection.includes(p.id));
  const add = (): void => {
    const t = text.trim();
    if (t === '') return;
    actions.addTag(selection, t);
    setText('');
  };

  if (parts.length === 0) {
    return (
      <section class="side-section">
        <h3>Selection</h3>
        <p class="muted">Click a part with nothing held to select it. Drag to select a box, Shift to add.</p>
      </section>
    );
  }
  const one = parts.length === 1 ? parts[0] : undefined;
  const name = (id: string): string => defs.find((d) => d.id === id)?.name ?? id;
  return (
    <section class="side-section">
      <h3>Selection</h3>
      {one ? (
        <p>
          <strong>{name(one.part)}</strong> <span class="muted">{one.id}</span>
          <br />
          <span class="muted">rotation {one.rot}°</span>
        </p>
      ) : (
        <p>
          <strong>{parts.length} parts</strong>
        </p>
      )}
      <div class="row">
        <button onClick={() => actions.rotate(-1)} title="Shift+R">
          Rotate left
        </button>
        <button onClick={() => actions.rotate(1)} title="R">
          Rotate right
        </button>
        <button class="danger" onClick={actions.deleteSelection} title="Delete">
          Delete
        </button>
      </div>
      <div class="tags">
        {tagCounts(draft, selection).map(({ tag, count }) => (
          <span class="tag" key={tag}>
            {tag}
            {parts.length > 1 && count < parts.length && <span class="muted"> {count}/{parts.length}</span>}
            <button class="tag-remove" aria-label={`remove tag ${tag}`} onClick={() => actions.removeTag(selection, tag)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div class="row">
        <input
          list="known-tags"
          placeholder="add a tag, like wheels"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <button onClick={add}>Add</button>
        <datalist id="known-tags">
          {allTags(draft).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <p class="muted small">Tags name groups of parts. Bindings target a tag.</p>
    </section>
  );
}
