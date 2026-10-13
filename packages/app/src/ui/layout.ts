/**
 * The builder's panel sizes, in CSS pixels (M16). The canvas fills the window behind the panels, so the board the
 * player sees is the window minus these. One place: the CSS reads them as variables, the board reads them to find
 * its middle.
 */
export const LAYOUT = { top: 38, hint: 26, drawer: 236, inspector: 312 } as const;

/** What the panels cover of the canvas, from each edge, in pixels. */
export const BOARD_INSETS = { left: LAYOUT.drawer, right: LAYOUT.inspector, top: LAYOUT.top, bottom: LAYOUT.hint } as const;

/** How far the middle of the visible board sits from the middle of the window, in pixels (x right, y down). */
export const BOARD_OFFSET = { x: (LAYOUT.drawer - LAYOUT.inspector) / 2, y: (LAYOUT.top - LAYOUT.hint) / 2 } as const;

/** Writes the sizes onto an element as the CSS variables `styles.css` lays the builder out with. */
export function applyLayout(el: HTMLElement): void {
  el.style.setProperty('--top-h', `${LAYOUT.top}px`);
  el.style.setProperty('--hint-h', `${LAYOUT.hint}px`);
  el.style.setProperty('--drawer-w', `${LAYOUT.drawer}px`);
  el.style.setProperty('--insp-w', `${LAYOUT.inspector}px`);
}

/**
 * How wide the script view is for a window (M16): it lies over the drawer and the left of the board, and leaves a
 * strip of board beside the inspector, wide enough to see the robot and click a part (at 1366 wide: 316 px of board).
 */
export function scriptViewWidth(windowWidth: number): number {
  const avail = Math.max(0, windowWidth - LAYOUT.inspector);
  const board = Math.max(280, Math.min(460, Math.round(avail * 0.3)));
  return Math.max(520, avail - board);
}
