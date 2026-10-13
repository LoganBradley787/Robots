import type { ComponentChildren } from 'preact';
import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Button } from './kit';

const K = ({ children }: { children: ComponentChildren }) => <kbd>{children}</kbd>;

/**
 * The line along the bottom (M16): one sentence about what a click does right now, the cell under the cursor at the
 * right, and `?` for every key. It replaces the stats pill and the grey wall of hotkeys.
 */
export function HintLine({ store, registry }: { store: Store<AppState>; registry: PartRegistry }) {
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const selected = useStore(store, (s) => s.builder.selection.length);
  const mirror = useStore(store, (s) => s.builder.mirror.on);
  const hover = useStore(store, (s) => s.builder.hover);
  const help = useStore(store, (s) => s.panel.overlay === 'help');
  const name = held && registry.has(held.part) ? registry.get(held.part).name : held?.part;
  return (
    <div class="hint plate">
      <span class="text">
        {selected > 0 ? (
          <>
            {selected} selected. <K>R</K> turns, <K>Del</K> removes, <K>Shift</K>+click adds or removes, <K>Esc</K> lets go.
          </>
        ) : stamp ? (
          <>
            Click to place a copy of <b>{stamp.name}</b>. <K>R</K> turns it, <K>F</K> flips it, <K>Esc</K> puts it down.
          </>
        ) : eraser ? (
          <>
            Click or drag over parts to remove them. <K>Esc</K> puts the eraser down.
          </>
        ) : held ? (
          <>
            Click or drag to place <b>{name}</b>. <K>R</K> turns it, <K>Esc</K> puts it down. Right-click a part to look at it.
          </>
        ) : (
          <>
            Click a part to select it, or drag a box around several. Take a part from the drawer, or press <K>1</K> to <K>9</K>, to build.
          </>
        )}
        {mirror && (
          <>
            {' '}
            Mirror is on: <K>[</K> and <K>]</K> move its line.
          </>
        )}
      </span>
      <span class="gap" />
      {hover && (
        <span class="cell" title="the cell under the cursor">
          {hover.x}, {hover.y}
        </span>
      )}
      <Button kind="ghost" on={help} title="Every key (?)" label="every key" onClick={() => store.set((s) => ({ panel: { ...s.panel, overlay: s.panel.overlay === 'help' ? undefined : 'help' } }))}>
        ?
      </Button>
    </div>
  );
}

const KEYS: ReadonlyArray<{ head: string; rows: ReadonlyArray<[keys: string, what: string]> }> = [
  {
    head: 'Build',
    rows: [
      ['1 to 9', 'take a part from the hotbar'],
      ['Click or drag', 'place the part in hand'],
      ['R', 'turn what you hold, or the selection (Shift+R the other way)'],
      ['E', 'the eraser: click or drag over parts'],
      ['Esc', 'put down what you hold, let go of the selection'],
      ['M', 'mirror on and off'],
      ['[ and ]', 'move the mirror line'],
      ['F', 'flip a held robot left to right'],
    ],
  },
  {
    head: 'Select',
    rows: [
      ['Click', 'with an empty hand, select a part'],
      ['Shift+click', 'add or remove one'],
      ['Drag', 'with an empty hand, select everything in the box'],
      ['Right-click', 'select a part and show it in the inspector'],
      ['Del', 'remove the selection'],
    ],
  },
  {
    head: 'Look around',
    rows: [
      ['Space+drag', 'move the board (or drag with the middle button)'],
      ['Wheel', 'zoom'],
      ['/', 'search the parts'],
      ['?', 'this list'],
    ],
  },
  {
    head: 'Robot',
    rows: [
      ['Cmd+S', 'save (with Shift: save as)'],
      ['Cmd+Z', 'undo (with Shift, or Cmd+Y: redo)'],
      ['Tab', 'test in the world, and back'],
    ],
  },
];

/** "Shift+click" as two key caps with the plus between them; " to ", " or " and " and " stay words. */
function Keys({ text }: { text: string }) {
  return <>{text.split(/( to | or | and |\+)/).map((t, i) => (i % 2 === 1 ? t : <kbd key={i}>{t}</kbd>))}</>;
}

/** The `?` card: every key the builder has, in one place. */
export function HelpCard({ store }: { store: Store<AppState> }) {
  const open = useStore(store, (s) => s.panel.overlay === 'help');
  if (!open) return null;
  return (
    <div class="help plate float">
      <div class="hd h">
        Every key
        <Button small kind="ghost" onClick={() => store.set((s) => ({ panel: { ...s.panel, overlay: undefined } }))}>
          Close
        </Button>
      </div>
      {KEYS.map((g) => (
        <div key={g.head}>
          <h4 class="h">{g.head}</h4>
          {g.rows.map(([keys, what]) => (
            <div class="k" key={what}>
              <span>
                <Keys text={keys} />
              </span>
              <span>{what}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
