import { useEffect, useRef, useState } from 'preact/hooks';

/** One saved blueprint as the store lists it. */
export interface BlueprintFile {
  file: string;
  name: string;
}

/** Picker groups, in the order shown (Logan: the plain dropdown got too long to find anything in). */
const GROUPS = ['Yours', 'Enemies', 'Missiles and bombs', 'Pieces and targets'] as const;

/** Which group a blueprint goes in, from its file name. */
export function groupOf(file: string): (typeof GROUPS)[number] {
  const n = file.replace(/\.json$/, '');
  if (n.startsWith('enemy-')) return 'Enemies';
  if (/(^|-)(missile|bomb)/.test(n) || /missile|drone-bomb/.test(n)) return 'Missiles and bombs';
  if (/rack|turret|wall|showcase|armor|^car$|^longcar$|^le-car$/.test(n)) return 'Pieces and targets';
  return 'Yours';
}

/** Every word typed appears somewhere in the name or file (any order, any case). */
export function matches(f: BlueprintFile, query: string): boolean {
  const hay = `${f.name} ${f.file}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => hay.includes(w));
}

/**
 * The builder's blueprint picker: a button with the open blueprint's name; click it for a search box over every saved
 * blueprint, grouped (yours, enemies, missiles and bombs, pieces and targets). Type to filter, arrows to move, Enter
 * opens, Esc closes.
 */
export function BlueprintPicker({ files, current, label, onOpen }: { files: readonly BlueprintFile[]; current: string | undefined; label: string; onOpen(file: string): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const shown = files.filter((f) => matches(f, query));
  const ordered = GROUPS.flatMap((g) => shown.filter((f) => groupOf(f.file) === g).sort((a, b) => a.name.localeCompare(b.name)));

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    box.current?.querySelector('.bp-item.at')?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  const pick = (f: BlueprintFile | undefined): void => {
    if (!f) return;
    setOpen(false);
    setQuery('');
    onOpen(f.file);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(ordered.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter') pick(ordered[index]);
    else if (e.key === 'Escape') setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let at = 0;
  return (
    <div class="bp-picker" ref={box}>
      <button class="bp-current" onClick={() => { setOpen(!open); setIndex(0); setQuery(''); }} title="Pick a blueprint (type to search)">
        {current === undefined ? '(not saved yet)' : label} <span class="bp-caret">▾</span>
      </button>
      {open && (
        <div class="bp-menu panel">
          <input
            ref={input}
            class="bp-search"
            placeholder={`Search ${files.length} blueprints`}
            value={query}
            onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setIndex(0); }}
            onKeyDown={onKey}
          />
          <div class="bp-list">
            {ordered.length === 0 && <div class="bp-empty">Nothing matches</div>}
            {GROUPS.map((g) => {
              const items = ordered.filter((f) => groupOf(f.file) === g);
              if (items.length === 0) return null;
              return (
                <div key={g} class="bp-group">
                  <div class="bp-group-head">{g} <span class="bp-count">{items.length}</span></div>
                  {items.map((f) => {
                    const i = at++;
                    return (
                      <div
                        key={f.file}
                        class={`bp-item${i === index ? ' at' : ''}${f.file === current ? ' current' : ''}`}
                        onMouseEnter={() => setIndex(i)}
                        onMouseDown={(e) => { e.preventDefault(); pick(f); }}
                      >
                        {f.name}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
