import type { Mode } from '../app/modes';

/** State shared between the canvas screens and the Preact panels. */
export interface AppState {
  mode: Mode;
}
