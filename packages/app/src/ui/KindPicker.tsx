import { useEffect, useRef, useState } from 'preact/hooks';
import { cleanKind, NO_KIND } from '../builder/library';
import { Popover } from './kit';

/**
 * A robot's kind as a small label you click to change (M16): pick one of the kinds there are, or type a new one.
 * The library groups robots by it.
 */
export function KindPicker({ kind, kinds, onPick, class: cls = 'kind' }: { kind: string | undefined; kinds: readonly string[]; onPick(kind: string | undefined): void; class?: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const pick = (k: string | undefined): void => {
    setOpen(false);
    if (k !== kind) onPick(k);
  };
  return (
    <>
      <button type="button" ref={anchor} class={`btn h ${cls}`} title="What kind of robot this is. The library groups by it. Click to change." aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {kind ?? NO_KIND}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)}>
          <div class="mi-head h">Kind</div>
          {kinds.map((k) => (
            <button type="button" key={k} role="option" aria-selected={k === kind} class={`mi${k === kind ? ' on' : ''}`} onClick={() => pick(k)}>
              <span>{k}</span>
            </button>
          ))}
          <button type="button" role="option" aria-selected={kind === undefined} class={`mi${kind === undefined ? ' on' : ''}`} onClick={() => pick(undefined)}>
            <span class="dim">{NO_KIND}</span>
          </button>
          <div class="mi-sep" />
          <input
            ref={input}
            class="field"
            placeholder="A new kind, then Enter"
            aria-label="a new kind"
            spellcheck={false}
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const k = cleanKind((e.target as HTMLInputElement).value);
              if (k !== undefined) pick(k);
            }}
          />
        </Popover>
      )}
    </>
  );
}
