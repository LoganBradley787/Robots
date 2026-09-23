export interface KeyActions {
  togglePause(): void;
  step(): void;
  faster(): void;
  slower(): void;
  toggleDebug(): void;
  toggleGrid(): void;
  /** Re-follow the current robot if the camera was panned away, else switch to the next robot. */
  camera(): void;
  /** Clears every robot. Deliberately has no key; it is a toolbar button with a confirm. */
  reset(): void;
  /** Camera back to the drop point (toolbar only). */
  home(): void;
}

type WorldAction = Exclude<keyof KeyActions, 'reset' | 'home'>;

/**
 * World keys, by physical key code. Every letter and digit belongs to the robot (Logan, Gate 2: A and D drive),
 * so world controls use punctuation only. A test keeps it that way.
 */
export const WORLD_KEYS: Readonly<Record<string, { action: WorldAction; label: string }>> = {
  Space: { action: 'togglePause', label: 'pauses the world' },
  Period: { action: 'step', label: 'steps the world one tick' },
  BracketLeft: { action: 'slower', label: 'slows the world down' },
  BracketRight: { action: 'faster', label: 'speeds the world up' },
  Backslash: { action: 'toggleDebug', label: 'toggles debug outlines' },
  Backquote: { action: 'toggleGrid', label: 'toggles the grid' },
  Comma: { action: 'camera', label: 'moves the camera between robots' },
};

/** Keys that are never robot keys even though they are not in the table (they switch screens or cancel). */
const RESERVED: Readonly<Record<string, string>> = { Tab: 'switches between builder and world', Escape: 'cancels' };

export function worldKeyAction(code: string): WorldAction | undefined {
  return WORLD_KEYS[code]?.action;
}

/** Why a key cannot be a robot binding, or undefined when it can. */
export function worldKeyLabel(code: string): string | undefined {
  const label = WORLD_KEYS[code]?.label ?? RESERVED[code];
  return label === undefined ? undefined : `${code} ${label}`;
}

const KEY_TO_CODE: Record<string, string> = {
  ' ': 'Space',
  '.': 'Period',
  ']': 'BracketRight',
  '[': 'BracketLeft',
  '\\': 'Backslash',
  '`': 'Backquote',
  ',': 'Comma',
};

/** Synthetic events from automation tools can arrive with an empty code; fall back to the key. */
export function codeOf(e: { code: string; key: string }): string {
  if (e.code) return e.code;
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  return KEY_TO_CODE[e.key] ?? '';
}

/** Keys typed into a text field belong to the field, never to the game. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** Binds the world keys while `active()` is true. Returns an unbind function. Uses event.code so layouts do not matter. */
export function bindKeys(target: Window, actions: KeyActions, active: () => boolean = () => true): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !active() || isTypingTarget(e.target)) return;
    const action = worldKeyAction(codeOf(e));
    if (!action) return;
    e.preventDefault();
    actions[action]();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
