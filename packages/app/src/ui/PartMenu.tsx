import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { defaultSize, type Blueprint, type PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { autoLabel } from '../builder/bindings';

export interface PartMenuActions {
  addTag(ids: string[], tag: string): void;
  removeTag(ids: string[], tag: string): void;
  setAuto(ids: string[], on: boolean): void;
  /** M10: start these parts (ones that need arming) armed or not. */
  setArmed(ids: string[], on: boolean): void;
  /** M12: what these fabricators build: a saved blueprint's file, a recipe the blueprint has, or nothing. */
  setMakes(ids: string[], choice: { file: string } | { recipe: string } | undefined): void;
  /** M12: grow or shrink these stretchy parts' hollows, each from its own size. */
  resize(ids: string[], dw: number, dh: number): void;
  rotate(dir: 1 | -1): void;
  deleteSelection(): void;
  closeMenu(): void;
}

/** Explicit tags (not the implicit id tag) of the parts, with how many parts carry each. */
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

/**
 * The part menu (right-click a part, `11`), in the spirit of Kerbal Space Program's: what the parts are, their auto
 * controls, tags (groups), rotation, delete. Edits every part it was opened on. Esc or a click on the canvas closes it.
 */
export function PartMenu({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: PartMenuActions }) {
  const menu = useStore(store, (s) => s.builder.menu);
  const draft = useStore(store, (s) => s.builder.draft);
  const files = useStore(store, (s) => s.doc.files);
  const docFile = useStore(store, (s) => s.doc.file);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!menu || !box.current) return;
    // Open beside the cursor, kept on screen.
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.min(menu.x + 14, window.innerWidth - r.width - 8), top: Math.max(8, Math.min(menu.y - 12, window.innerHeight - r.height - 8)) });
  }, [menu?.x, menu?.y, menu?.ids.length]);
  if (!menu || menu.ids.length === 0) return null;
  const ids = menu.ids;
  const parts = draft.parts.filter((p) => ids.includes(p.id));
  const names = new Map<string, number>();
  for (const p of parts) {
    const n = registry.has(p.part) ? registry.get(p.part).name : p.part;
    names.set(n, (names.get(n) ?? 0) + 1);
  }
  const title =
    parts.length === 1
      ? [...names.keys()][0]
      : `${parts.length} parts: ${[...names].map(([n, c]) => `${c} ${n.toLowerCase()}${c === 1 ? '' : 's'}`).join(', ')}`;
  const one = parts.length === 1 ? parts[0] : undefined;
  const autoParts = parts.filter((p) => autoLabel(registry, p) !== undefined);
  const autoOn = autoParts.filter((p) => p.auto !== false).length;
  const armParts = parts.filter((p) => registry.has(p.part) && registry.get(p.part).arming === true);
  const armedOn = armParts.filter((p) => p.armed === true).length;
  const makers = parts.filter((p) => registry.has(p.part) && registry.get(p.part).fabricate !== undefined);
  const makes = new Set(makers.map((p) => p.makes ?? ''));
  const current = makes.size === 1 ? [...makes][0] : undefined;
  const stretchy = parts.filter((p) => registry.has(p.part) && registry.get(p.part).stretch !== undefined);
  const first = stretchy[0];
  const spec = first ? registry.get(first.part).stretch : undefined;
  const size: [number, number] = first ? (first.size ?? defaultSize(registry.get(first.part)) ?? [1, 1]) : [1, 1];
  const resize = (dw: number, dh: number): void => actions.resize(stretchy.map((p) => p.id), dw, dh);
  const add = (): void => {
    const t = text.trim();
    if (t === '') return;
    actions.addTag(ids, t);
    setText('');
  };

  return (
    <div class="part-menu panel" ref={box} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onContextMenu={(e) => e.preventDefault()}>
      <div class="part-menu-head">
        <strong>{title}</strong>
        <button class="tag-remove" aria-label="close" onClick={actions.closeMenu}>
          ×
        </button>
      </div>
      {one && (
        <p class="muted small">
          {one.id}, rotation {one.rot}°{registry.has(one.part) ? `, health ${registry.get(one.part).health}` : ''}
        </p>
      )}
      {autoParts.length > 0 && (
        <label class="check">
          <input
            type="checkbox"
            checked={autoOn === autoParts.length}
            ref={(el) => {
              if (el) el.indeterminate = autoOn > 0 && autoOn < autoParts.length;
            }}
            onChange={(e) => actions.setAuto(autoParts.map((p) => p.id), (e.target as HTMLInputElement).checked)}
          />
          <span>
            Auto controls
            <span class="muted">
              {' '}
              {autoParts.length === 1 && autoParts[0] ? autoLabel(registry, autoParts[0]) : `on for ${autoOn} of ${autoParts.length}`}
            </span>
          </span>
        </label>
      )}
      {autoParts.length > 0 && draft.autoControls === false && <p class="muted small">Auto controls are off for this whole blueprint (Controls panel).</p>}
      {armParts.length > 0 && (
        <label class="check" title="An unarmed warhead is a plain part: it breaks without exploding and ignores detonate. A key or script arms it (its arm input), for good.">
          <input
            type="checkbox"
            checked={armedOn === armParts.length}
            ref={(el) => {
              if (el) el.indeterminate = armedOn > 0 && armedOn < armParts.length;
            }}
            onChange={(e) => actions.setArmed(armParts.map((p) => p.id), (e.target as HTMLInputElement).checked)}
          />
          <span>
            Armed at start
            <span class="muted"> {armParts.length === 1 ? (armedOn === 1 ? 'live from deploy' : 'safe until armed') : `${armedOn} of ${armParts.length}`}</span>
          </span>
        </label>
      )}
      {spec && (
        <div class="size-row" title="The size of its hollow: what it builds must fit inside. Parts in the way are reported in the issues list.">
          <span>Hollow</span>
          <button onClick={() => resize(-1, 0)} aria-label="narrower">-</button>
          <span>{stretchy.length > 1 && stretchy.some((p) => JSON.stringify(p.size) !== JSON.stringify(first?.size)) ? 'mixed' : `${size[0]} wide`}</span>
          <button onClick={() => resize(1, 0)} aria-label="wider">+</button>
          <button onClick={() => resize(0, -1)} aria-label="shorter">-</button>
          <span>{size[1]} tall</span>
          <button onClick={() => resize(0, 1)} aria-label="taller">+</button>
        </div>
      )}
      {makers.length > 0 && (
        <label class="makes" title="What the bay builds: a copy of a blueprint, from the robot's energy, held until its release input lets it go. It must fit the bay's hollow (the issues list says if not).">
          <span>Makes </span>
          <select
            value={current === undefined ? '*' : current === '' ? '' : `recipe:${current}`}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === '') actions.setMakes(makers.map((p) => p.id), undefined);
              else if (v.startsWith('recipe:')) actions.setMakes(makers.map((p) => p.id), { recipe: v.slice(7) });
              else if (v.startsWith('file:')) actions.setMakes(makers.map((p) => p.id), { file: v.slice(5) });
              (e.target as HTMLSelectElement).blur();
            }}
          >
            {current === undefined && <option value="*">(several)</option>}
            <option value="">nothing</option>
            {(draft.recipes ?? []).map((r) => (
              <option key={`r-${r.name}`} value={`recipe:${r.name}`}>
                {r.name}
              </option>
            ))}
            <optgroup label="a copy of a saved blueprint">
              {files.filter((f) => f.file !== docFile).map((f) => (
                <option key={`f-${f.file}`} value={`file:${f.file}`}>
                  {f.file.replace(/\.json$/, '')}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      <div class="tags">
        {tagCounts(draft, ids).map(({ tag, count }) => (
          <span class="tag" key={tag}>
            {tag}
            {parts.length > 1 && count < parts.length && <span class="muted"> {count}/{parts.length}</span>}
            <button class="tag-remove" aria-label={`remove tag ${tag}`} onClick={() => actions.removeTag(ids, tag)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div class="row">
        <input
          list="known-tags"
          placeholder="add to a group, like wheels"
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
    </div>
  );
}
