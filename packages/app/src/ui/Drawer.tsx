import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { footprintBox, type PartDef, type PartRegistry } from '@robots/sim-core';
import { isTypingTarget } from '../app/keys';
import { hotbarKey, RECENT_SHOWN } from '../builder/hotbar';
import { groupByKind, partSections } from '../builder/library';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Sprite, Tabs } from './kit';
import { num } from './format';

/** What a dragged tile carries: the part's id. The hotbar's slots take it. */
export const DRAG_PART = 'application/x-robots-part';

/**
 * The parts drawer (M16), at the left. Parts: a search box (`/`), the parts taken last, then every part of the
 * registry under its category as a tile with its real sprite and full name. Assemblies: saved robots to place inside
 * this one. Nothing here names a part: sections, names and hover text all come from the part definitions.
 */
export function Drawer({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: BuilderActions }) {
  const tab = useStore(store, (s) => s.panel.drawer);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const setTab = (drawer: 'parts' | 'assemblies'): void => {
    setQuery('');
    store.set((s) => ({ panel: { ...s.panel, drawer } }));
  };
  // `/` goes to the search box from anywhere on the builder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || store.get().dialog || store.get().panel.overlay === 'library') return;
      e.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="drawer plate">
      <Tabs
        tabs={[
          { id: 'parts', label: 'Parts' },
          { id: 'assemblies', label: 'Assemblies' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div class="search-row">
        <input
          ref={search}
          class="field"
          placeholder={tab === 'parts' ? 'Search parts' : 'Search robots to place'}
          aria-label={tab === 'parts' ? 'search parts' : 'search robots to place inside this one'}
          value={query}
          spellcheck={false}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Enter') {
              // Enter takes the first thing found.
              if (tab === 'parts') {
                const first = partSections(registry.list(), query)[0]?.parts[0];
                if (first) actions.hold(first.id);
              } else {
                const doc = store.get().doc;
                const first = groupByKind(doc.files.filter((f) => f.file !== doc.file), query)[0]?.files[0];
                if (first) actions.holdBlueprint(first.file);
              }
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <kbd class="kbd">/</kbd>
      </div>
      {tab === 'parts' ? <Parts store={store} registry={registry} actions={actions} query={query} /> : <Assemblies store={store} actions={actions} query={query} />}
    </div>
  );
}

function Parts({ store, registry, actions, query }: { store: Store<AppState>; registry: PartRegistry; actions: BuilderActions; query: string }) {
  const held = useStore(store, (s) => s.builder.held?.part);
  const icons = useStore(store, (s) => s.icons);
  const hotbar = useStore(store, (s) => s.hotbar);
  const recent = useStore(store, (s) => s.recent);
  const [card, setCard] = useState<{ def: PartDef; top: number } | undefined>(undefined);
  const sections = partSections(registry.list(), query);
  const tile = (d: PartDef) => {
    const key = hotbarKey(hotbar, d.id);
    return (
      <button
        type="button"
        key={d.id}
        class={`tile${held === d.id ? ' on' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer?.setData(DRAG_PART, d.id);
          e.dataTransfer?.setData('text/plain', d.name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          setCard(undefined);
        }}
        onClick={() => actions.hold(d.id)}
        onMouseEnter={(e) => setCard({ def: d, top: (e.currentTarget as HTMLElement).getBoundingClientRect().top })}
        aria-label={d.name}
      >
        {key !== undefined && <span class="key">{key}</span>}
        <Sprite src={icons[d.id]} size={40} />
        <span>{d.name}</span>
      </button>
    );
  };
  const recents = recent.slice(0, RECENT_SHOWN).filter((id) => registry.has(id));
  return (
    <>
      <div class="scroll" onMouseLeave={() => setCard(undefined)} onScroll={() => setCard(undefined)}>
        {query.trim() === '' && recents.length > 0 && (
          <>
            <div class="cat h">Recent</div>
            <div class="tiles">{recents.map((id) => tile(registry.get(id)))}</div>
          </>
        )}
        {sections.map((s) => (
          <div key={s.category}>
            <div class="cat h">{s.category}</div>
            <div class="tiles">{s.parts.map(tile)}</div>
          </div>
        ))}
        {sections.length === 0 && <p class="empty">No part matches "{query.trim()}".</p>}
      </div>
      {card && <PartCard def={card.def} top={card.top} />}
    </>
  );
}

/** The card beside a hovered tile: what the part does and its numbers, all from its definition. */
function PartCard({ def, top }: { def: PartDef; top: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(top);
  useLayoutEffect(() => {
    const h = box.current?.getBoundingClientRect().height ?? 0;
    setY(Math.max(46, Math.min(top, window.innerHeight - h - 34)));
  }, [def, top]);
  const size = footprintBox(def, def.footprint);
  return (
    <div ref={box} class="card plate float" style={{ left: 'calc(var(--drawer-w) + 8px)', top: `${y}px` }}>
      <div class="t h">{def.name}</div>
      {def.about !== undefined && <div class="about">{def.about}</div>}
      <PartNumbers def={def} />
      {def.footprint.length > 1 && (
        <div class="kv">
          <span>Size</span>
          <b>
            {size.w} by {size.h} cells
          </b>
        </div>
      )}
      {def.inputs.length > 0 && (
        <div class="kv">
          <span>You control</span>
          <b>{def.inputs.map((c) => c.name).join(', ')}</b>
        </div>
      )}
      {def.outputs.length > 0 && (
        <div class="kv">
          <span>It reports</span>
          <b>{def.outputs.map((c) => c.name).join(', ')}</b>
        </div>
      )}
    </div>
  );
}

/** Mass, health, and what it uses and holds: the rows the hover card and the inspector share. */
export function PartNumbers({ def, mass }: { def: PartDef; mass?: number }) {
  return (
    <>
      <div class="kv">
        <span>Mass</span>
        <b>{num(mass ?? def.mass)} kg</b>
      </div>
      <div class="kv">
        <span>Health</span>
        <b>{num(def.health)}</b>
      </div>
      {def.powerDraw > 0 && (
        <div class="kv" title="energy a second, working at full power">
          <span>Energy use</span>
          <b>{num(def.powerDraw)} /s</b>
        </div>
      )}
      {def.resource !== undefined && (
        <div class="kv">
          <span>Holds</span>
          <b>
            {num(def.resource.capacity)} {def.resource.kind}
          </b>
        </div>
      )}
    </>
  );
}

function Assemblies({ store, actions, query }: { store: Store<AppState>; actions: BuilderActions; query: string }) {
  const doc = useStore(store, (s) => s.doc);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const meta = useStore(store, (s) => s.meta);
  // Every saved robot except the one open (placing a robot on itself would be a copy of a copy).
  const saved = doc.files.filter((f) => f.file !== doc.file);
  useEffect(() => actions.needMeta(saved.map((f) => f.file)), [doc.files, doc.file]);
  const groups = groupByKind(saved, query);
  return (
    <div class="scroll">
      {saved.length === 0 && <p class="empty">No saved robots yet. Save one and it shows up here, to place inside another.</p>}
      {saved.length > 0 && groups.length === 0 && <p class="empty">No robot matches "{query.trim()}".</p>}
      {groups.map((g) => (
        <div key={g.kind}>
          <div class="cat h">
            {g.kind} <span class="n">{g.files.length}</span>
          </div>
          {g.files.map((f) => (
            <button type="button" key={f.file} class={`asm${stamp?.name === f.name ? ' on' : ''}`} title="Take a copy in hand to place inside this robot: R turns it, F flips it, Esc puts it down" onClick={() => actions.holdBlueprint(f.file)}>
              <Thumb src={meta[f.file]?.thumb} waiting={meta[f.file] === undefined} />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A robot's small picture; a grey block while it is being drawn. */
export function Thumb({ src, waiting }: { src: string | undefined; waiting: boolean }) {
  return <span class={`thumb${waiting ? ' wait' : ''}`}>{src !== undefined && <img src={src} alt="" draggable={false} />}</span>;
}
