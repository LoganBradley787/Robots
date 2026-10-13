import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * The builder's own controls (M16, look: Shop floor). No native select, checkbox or number box anywhere: these are
 * the pieces every panel is made of, so the whole UI reads as one thing. Their looks are in `styles.css`.
 */

const cx = (...parts: Array<string | false | undefined>): string => parts.filter((p) => p !== false && p !== undefined && p !== '').join(' ');

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  /** `go` is the one yellow action; `ghost` has no plate until hovered; `danger` removes something. */
  kind?: 'go' | 'ghost' | 'danger';
  /** Lit: the thing it switches is on. */
  on?: boolean;
  small?: boolean;
  /** A square button holding one glyph. */
  icon?: boolean;
  disabled?: boolean;
  title?: string;
  label?: string;
  class?: string;
}

export function Button({ children, onClick, kind, on, small, icon, disabled, title, label, class: extra }: ButtonProps) {
  return (
    <button type="button" class={cx('btn', kind, on && 'on', small && 'small', icon && 'icon', extra)} onClick={onClick} disabled={disabled} title={title} aria-label={label} aria-pressed={on}>
      {children}
    </button>
  );
}

/** A key as it looks on a keyboard. `auto`: a key the game chose; `small`: inline in a row of text. */
export function KeyCap({ children, auto, small, title }: { children: ComponentChildren; auto?: boolean; small?: boolean; title?: string }) {
  return (
    <kbd class={cx('cap', auto && 'auto', small && 'small')} title={title}>
      {children}
    </kbd>
  );
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: ReadonlyArray<TabSpec<T>>; value: T; onChange(id: T): void }) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((t) => (
        <button type="button" key={t.id} role="tab" aria-selected={t.id === value} class={cx('tab', t.id === value && 'on')} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** On or off, with its name beside it. */
export function Switch({ on, onChange, children, title }: { on: boolean; onChange(on: boolean): void; children?: ComponentChildren; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} class={cx('switch', on && 'on')} onClick={() => onChange(!on)} title={title}>
      <span class="track" />
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}

/** A square to tick. `mixed`: some of the things it stands for are on; a click turns them all on. */
export function Check({ checked, onChange, children, title, disabled }: { checked: boolean | 'mixed'; onChange(on: boolean): void; children: ComponentChildren; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      class={cx('check', checked === true && 'on', checked === 'mixed' && 'mixed')}
      onClick={() => onChange(checked !== true)}
      title={title}
      disabled={disabled}
    >
      <span class="box" />
      <span>{children}</span>
    </button>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** One of a few, all visible. */
export function Segmented<T extends string>({ options, value, onChange }: { options: ReadonlyArray<SegOption<T>>; value: T; onChange(value: T): void }) {
  return (
    <div class="seg" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={o.value === value} class={cx(o.value === value && 'on')} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step, onChange, disabled, label, title }: { value: number; min: number; max: number; step?: number; onChange(value: number): void; disabled?: boolean; label?: string; title?: string }) {
  return (
    <input
      class="slider"
      type="range"
      min={min}
      max={max}
      step={step ?? 'any'}
      value={value}
      disabled={disabled}
      aria-label={label}
      title={title}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      // Let go of focus, so the arrow keys and letters go back to the game.
      onPointerUp={(e) => (e.target as HTMLInputElement).blur()}
    />
  );
}

/** A number typed as text: no spinner arrows. Enter or leaving the field commits; Esc puts the old value back. */
export function NumberField({ value, onChange, title, label }: { value: number; onChange(value: number): void; title?: string; label?: string }) {
  return (
    <input
      class="field mono"
      type="text"
      inputMode="decimal"
      value={String(value)}
      title={title}
      aria-label={label}
      onChange={(e) => {
        const el = e.target as HTMLInputElement;
        const v = Number(el.value);
        if (el.value.trim() !== '' && Number.isFinite(v)) onChange(v);
        else el.value = String(value);
      }}
      onKeyDown={(e) => {
        const el = e.target as HTMLInputElement;
        if (e.key === 'Escape') el.value = String(value);
        if (e.key === 'Enter' || e.key === 'Escape') el.blur();
      }}
    />
  );
}

/**
 * A box that opens under (or over) its anchor and stays on screen. It is fixed to the window, so a scrolling panel
 * never cuts it off. A press anywhere else, Esc, or a resize closes it.
 */
export function Popover({ anchor, onClose, children, align = 'left', class: extra }: { anchor: RefObject<HTMLElement>; onClose(): void; children: ComponentChildren; align?: 'left' | 'right'; class?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const a = anchor.current;
    const b = box.current;
    if (!a || !b) return;
    const r = a.getBoundingClientRect();
    const s = b.getBoundingClientRect();
    const left = Math.max(6, Math.min(align === 'right' ? r.right - s.width : r.left, window.innerWidth - s.width - 6));
    const below = r.bottom + 4;
    const top = below + s.height > window.innerHeight - 6 ? Math.max(6, r.top - s.height - 4) : below;
    setPos({ left, top });
  }, []);
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
    };
  }, []);
  return (
    <div ref={box} class={cx('pop plate float', extra)} style={{ left: `${pos?.left ?? 0}px`, top: `${pos?.top ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onPick(): void;
  /** Shown at the right: a key, or a word. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}

/** A button that opens a short list of things to do. */
export function Menu({ label, title, items, kind = 'ghost', align }: { label: ComponentChildren; title?: string; items: ReadonlyArray<MenuItem | 'sep'>; kind?: 'ghost'; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <Button kind={kind} on={open} onClick={() => setOpen(!open)} {...(title !== undefined ? { title } : {})}>
        {label}
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} {...(align ? { align } : {})}>
          {items.map((it, i) =>
            it === 'sep' ? (
              <div class="mi-sep" key={i} />
            ) : (
              <button
                type="button"
                key={i}
                class={cx('mi', it.danger && 'danger')}
                disabled={it.disabled}
                title={it.title}
                onClick={() => {
                  setOpen(false);
                  it.onPick();
                }}
              >
                <span>{it.label}</span>
                {it.hint !== undefined && <span class="mono small">{it.hint}</span>}
              </button>
            ),
          )}
        </Popover>
      )}
    </span>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** Options with the same group sit under one heading, in the order given. */
  group?: string;
}

/**
 * Pick one of a list: the box shows the choice, a press opens the list (with a search box when it is long).
 * `value` not in `options` shows `placeholder`.
 */
export function Select({ value, options, onChange, placeholder, title, label }: { value: string | undefined; options: ReadonlyArray<SelectOption>; onChange(value: string): void; placeholder?: string; title?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value);
  const long = options.length > 9;
  useLayoutEffect(() => {
    if (open) search.current?.focus();
    else setQuery('');
  }, [open]);
  const q = query.trim().toLowerCase();
  const shown = q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  const pick = (v: string): void => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  let lastGroup: string | undefined;
  return (
    <>
      <button type="button" ref={anchor} class="pick" title={title} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class={current ? '' : 'dim'}>{current?.label ?? placeholder ?? ''}</span>
        <span class="caret">&#9662;</span>
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)}>
          {long && (
            <input
              ref={search}
              class="field"
              placeholder="Search"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) pick(shown[0].value);
              }}
            />
          )}
          {shown.length === 0 && <div class="mi-head">Nothing matches</div>}
          {shown.map((o) => {
            const head = o.group !== undefined && o.group !== lastGroup ? o.group : undefined;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {head !== undefined && <div class="mi-head h">{head}</div>}
                <button type="button" role="option" aria-selected={o.value === value} class={cx('mi', o.value === value && 'on')} onClick={() => pick(o.value)}>
                  <span>{o.label}</span>
                </button>
              </div>
            );
          })}
        </Popover>
      )}
    </>
  );
}

/** A part's picture, from the same textures the board draws. `rot` is the part's turn, counterclockwise. */
export function Sprite({ src, size, rot = 0 }: { src: string | undefined; size: number; rot?: number }) {
  const style = { width: `${size}px`, height: `${size}px`, ...(rot !== 0 ? { transform: `rotate(${-rot}deg)` } : {}) };
  return src !== undefined ? <img class="spr" src={src} alt="" draggable={false} style={style} /> : <span class="spr missing" style={style} />;
}
