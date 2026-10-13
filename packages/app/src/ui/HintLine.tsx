import type { ComponentChildren } from 'preact';
import type { PartRegistry } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { Button } from './kit';
import { handText } from './BoardChips';
import { MOD } from './format';

const K = ({ children }: { children: ComponentChildren }) => <kbd>{children}</kbd>;

/**
 * The line along the bottom (M16): one sentence about what a click does right now, the cell under the cursor at the
 * right, and `?` for every key. It replaces the stats pill and the grey wall of hotkeys.
 */
export function HintLine({ store, registry }: { store: Store<AppState>; registry: PartRegistry }) {
  const held = useStore(store, (s) => s.builder.held);
  const copy = useStore(store, (s) => s.builder.copy);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const selected = useStore(store, (s) => s.builder.selection.length);
  const dragging = useStore(store, (s) => s.builder.dragging);
  const mirror = useStore(store, (s) => s.builder.mirror.on);
  const hover = useStore(store, (s) => s.builder.hover);
  const help = useStore(store, (s) => s.panel.overlay === 'help');
  const what = handText({ ...(held ? { held } : {}), ...(copy ? { copy } : {}), ...(stamp ? { stamp } : {}), eraser }, registry);
  const both = mirror ? ' on both sides' : '';
  return (
    <div class="hint plate">
      <span class="text">
        {dragging === 'move' ? (
          <>
            Let go to drop {selected === 1 ? 'it' : `the ${selected} parts`} there{mirror ? ', with the mirror image' : ''}. Red outlines: something is in the way and nothing will move. <K>Esc</K> calls it off.
          </>
        ) : dragging === 'box' ? (
          <>
            Let go to select what the box covers. <K>Esc</K> calls it off.
          </>
        ) : stamp ? (
          <>
            Click to place a copy of <b>{stamp.name}</b>
            {both}. <K>R</K> turns it, <K>F</K> flips it, <K>Esc</K> or right-click puts it down.
          </>
        ) : copy ? (
          copy.types.length === 1 ? (
            <>
              Click or drag on empty cells to place <b>{what}</b>
              {both}, with its groups and settings. <K>R</K> turns it, <K>Shift</K> swaps what is there, <K>Esc</K> or right-click puts it down.
            </>
          ) : (
            <>
              Click to place the <b>{what?.toLowerCase()}</b>
              {both}, groups and settings and all. <K>R</K> turns it, <K>F</K> flips it, <K>Esc</K> or right-click puts it down.
            </>
          )
        ) : eraser ? (
          <>
            Click or drag over parts to remove them{both}. <K>Esc</K> or right-click puts the eraser down.
          </>
        ) : held ? (
          <>
            Click or drag on empty cells to place <b>{what}</b>
            {both}. <K>R</K> turns it, <K>Shift</K> swaps what is there, <K>Esc</K> or right-click puts it down.
          </>
        ) : selected > 0 ? (
          <>
            {selected} selected. Drag to move, arrows nudge, <K>R</K> turns, <K>Del</K> removes, <K>{MOD}</K>+<K>D</K> copies, <K>Shift</K>+click adds or removes, <K>Esc</K> lets go.
          </>
        ) : (
          <>
            Click a part to select it, drag it to move it, drag across empty cells for a box. <K>Alt</K>+click a part for another like it. <K>1</K> to <K>9</K> take a part.
          </>
        )}
        {mirror && !dragging && (
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
    head: 'With something in hand',
    rows: [
      ['1 to 9', 'take a part from the hotbar'],
      ['Click or drag', 'place it on empty cells (a taken cell says why not)'],
      ['Shift+click', 'swap what is there for it, keeping its groups and settings'],
      ['R', 'turn it (Shift+R the other way)'],
      ['F', 'flip a held robot or a held copy left to right'],
      ['E', 'the eraser: click or drag over parts'],
      ['Esc or Right-click', 'put it down'],
    ],
  },
  {
    head: 'With an empty hand',
    rows: [
      ['Click', 'select a part'],
      ['Shift+click', 'add or remove one'],
      ['Drag', 'a selected part: move the selection. Empty cells: a box'],
      ['Arrows', 'nudge the selection one cell'],
      ['R', 'turn the selection (Shift+R the other way)'],
      ['Del', 'remove the selection'],
      [`${MOD}+D`, 'a copy of the selection in the hand, groups and settings and all'],
      ['Alt+click', 'another like that part, in the hand'],
      [`${MOD}+A`, 'select everything'],
      ['Right-click', 'select a part and show it in the inspector'],
      ['Esc', 'let go of the selection, then put out a script light'],
    ],
  },
  {
    head: 'Mirror',
    rows: [
      ['M', 'mirror on and off: both sides land, or neither'],
      ['[ and ]', 'move the mirror line'],
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
      [`${MOD}+S`, 'save (with Shift: save as)'],
      [`${MOD}+Z`, `undo (with Shift, or ${MOD}+Y: redo)`],
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
