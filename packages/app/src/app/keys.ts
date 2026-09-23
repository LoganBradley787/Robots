export interface KeyActions {
  togglePause(): void;
  step(): void;
  faster(): void;
  slower(): void;
  toggleDebug(): void;
  toggleFollow(): void;
  cycleTarget(): void;
  toggleGrid(): void;
  reset(): void;
}

const KEY_TO_CODE: Record<string, string> = { ' ': 'Space', '.': 'Period', ']': 'BracketRight', '[': 'BracketLeft' };

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

/**
 * Binds the world's control keys while `active()` is true. Returns an unbind function.
 * Uses event.code so layouts do not matter.
 */
export function bindKeys(target: Window, actions: KeyActions, active: () => boolean = () => true): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || !active() || isTypingTarget(e.target)) return;
    switch (codeOf(e)) {
      case 'Space':
        e.preventDefault();
        actions.togglePause();
        break;
      case 'Period':
        actions.step();
        break;
      case 'BracketRight':
        actions.faster();
        break;
      case 'BracketLeft':
        actions.slower();
        break;
      case 'KeyD':
        actions.toggleDebug();
        break;
      case 'KeyF':
        actions.toggleFollow();
        break;
      case 'KeyC':
        actions.cycleTarget();
        break;
      case 'KeyG':
        actions.toggleGrid();
        break;
      case 'KeyR':
        actions.reset();
        break;
      default:
        return;
    }
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
