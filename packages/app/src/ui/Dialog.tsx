import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ActiveDialog } from './appState';

export function Dialog({ dialog }: { dialog: ActiveDialog }) {
  const [text, setText] = useState(dialog.input?.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const primary = dialog.buttons.find((b) => b.kind === 'primary') ?? dialog.buttons[0];
  // Read the field itself: typing that lands before a re-render must still count.
  const answer = (value: string): void => dialog.resolve({ value, input: input.current?.value ?? text });

  // Focus before paint, so the first keystrokes after the dialog appears go into the field.
  useLayoutEffect(() => {
    setText(dialog.input?.value ?? '');
    const el = input.current;
    if (el) {
      el.value = dialog.input?.value ?? '';
      el.focus();
      el.select();
    }
  }, [dialog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        answer(dialog.cancelValue);
      } else if (e.key === 'Enter' && primary) {
        // Enter on a focused button presses that button (native click), not the primary one.
        if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.stopPropagation();
        answer(primary.value);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="dialog-backdrop panel" onPointerDown={(e) => e.target === e.currentTarget && answer(dialog.cancelValue)}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
        <h2>{dialog.title}</h2>
        {dialog.message && <p>{dialog.message}</p>}
        {dialog.input && (
          <input ref={input} value={text} placeholder={dialog.input.placeholder} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        )}
        <div class="dialog-buttons">
          {dialog.buttons.map((b) => (
            <button key={b.value} class={b.kind ?? ''} onClick={() => answer(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
