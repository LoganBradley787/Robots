import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { BuilderActions } from './actions';
import { Button } from './kit';

/** Runs `done` after `ms`, unless the mouse is resting on the thing (`held`). Starts over when `key` changes. */
function useFade(key: number | undefined, ms: number, held: boolean, done: () => void): void {
  useEffect(() => {
    if (key === undefined || held) return;
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  }, [key, ms, held]);
}

/**
 * What the last edit affected (M16): said after the edit, never asked before it, with Undo in it. It goes away by
 * itself, and at the next edit.
 */
export function EditNote({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'undo' | 'dismissNote'> }) {
  const note = useStore(store, (s) => s.builder.note);
  const [over, setOver] = useState(false);
  // Long enough to read: a line takes a couple of seconds.
  useFade(note?.seq, 4500 + 2200 * (note?.lines.length ?? 0), over, () => note && actions.dismissNote(note.seq));
  useEffect(() => setOver(false), [note?.seq]);
  if (!note) return null;
  return (
    <div class="edit-note plate float" role="status" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <div class="lines">
        {note.lines.map((l, i) => (
          <p key={i} class={l.bad ? 'bad' : ''}>
            {l.text}
          </p>
        ))}
      </div>
      <div class="acts">
        {note.undo && (
          <Button small onClick={actions.undo} title="Take the edit back">
            Undo
          </Button>
        )}
        <button type="button" class="x" aria-label="close" title="Close" onClick={() => actions.dismissNote(note.seq)}>
          &#10005;
        </button>
      </div>
    </div>
  );
}

/**
 * At the cursor (M16): why a click, drag or key did nothing, for about two seconds; or, after a blank part lands among
 * parts of its kind that share a group, an offer to join it, one click to take and easy to ignore.
 */
export function CursorNoteView({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'acceptOffer' | 'dismissCursorNote'> }) {
  const note = useStore(store, (s) => s.builder.cursorNote);
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined);
  const offers = note?.offers;
  useFade(note?.seq, offers ? 7000 : 2200, over, () => note && actions.dismissCursorNote(note.seq));
  useEffect(() => setOver(false), [note?.seq]);
  // Beside the cursor, kept on screen.
  useLayoutEffect(() => {
    const b = box.current;
    if (!note || !b) return;
    const s = b.getBoundingClientRect();
    setPos({ left: Math.max(6, Math.min(note.x + 14, window.innerWidth - s.width - 6)), top: Math.max(6, Math.min(note.y + 18, window.innerHeight - s.height - 6)) });
  }, [note?.seq]);
  if (!note) return null;
  const style = { left: `${pos?.left ?? note.x + 14}px`, top: `${pos?.top ?? note.y + 18}px` };
  if (!offers) {
    return (
      <div ref={box} class="cursor-note plate float refusal" role="status" style={style}>
        {note.text}
      </div>
    );
  }
  return (
    <div ref={box} class="cursor-note plate float offer" style={style} onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)} onContextMenu={(e) => e.preventDefault()}>
      <span class="dim">{offers[0] && offers[0].ids.length > 1 ? `These ${offers[0].ids.length} are blank.` : 'This one is blank.'}</span>
      {offers.slice(0, 3).map((o) => (
        <Button small key={o.tag} onClick={() => actions.acceptOffer(o)} title={`Its neighbours of the same kind are all in "${o.tag}". Keys and scripts that drive the group will drive ${o.ids.length === 1 ? 'it' : 'them'} too.`}>
          Add to group {o.tag}
        </Button>
      ))}
      <button type="button" class="x" aria-label="no thanks" title="No thanks" onClick={() => actions.dismissCursorNote(note.seq)}>
        &#10005;
      </button>
    </div>
  );
}
