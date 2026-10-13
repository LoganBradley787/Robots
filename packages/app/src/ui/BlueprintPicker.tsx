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

/** Open: a search box over every saved robot, grouped. Type to filter, arrows to move, Enter opens, Esc closes. */
export function BlueprintPicker({ files, current, onOpen, onClose }: { files: readonly BlueprintFile[]; current: string | undefined; onOpen(file: string): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const shown = files.filter((f) => matches(f, query));
  const ordered = GROUPS.flatMap((g) => shown.filter((f) => groupOf(f.file) === g).sort((a, b) => a.name.localeCompare(b.name)));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    box.current?.querySelector('.mi.at')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(ordered.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter') {
      const f = ordered[index];
      if (f) onOpen(f.file);
    } else return;
    e.preventDefault();
  };

  let at = 0;
  return (
    <div class="win plate" ref={box} style={{ width: '420px' }}>
      <div class="edhead">
        <span class="h" style={{ fontSize: '15px' }}>
          Open a robot
        </span>
        <span class="gap" />
        <button type="button" class="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div class="search-row">
        <input ref={input} class="field" placeholder={`Search ${files.length} robots`} value={query} onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setIndex(0); }} onKeyDown={onKey} />
      </div>
      <div class="scroll">
        {ordered.length === 0 && <p class="empty">Nothing matches.</p>}
        {GROUPS.map((g) => {
          const items = ordered.filter((f) => groupOf(f.file) === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div class="cat h">
                {g} <span class="n">{items.length}</span>
              </div>
              {items.map((f) => {
                const i = at++;
                return (
                  <button type="button" key={f.file} class={`mi${i === index ? ' at' : ''}${f.file === current ? ' on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => onOpen(f.file)}>
                    <span>{f.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
