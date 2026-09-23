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

/** Binds the control keys. Returns an unbind function. Uses event.code so layouts do not matter. */
export function bindKeys(target: Window, actions: KeyActions): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
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
