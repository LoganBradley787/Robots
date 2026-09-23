import type { AppState, DialogSpec } from './appState';
import type { Store } from './store';

/** Opens a modal and resolves with the button value (and the text field, if any). One dialog at a time. */
export function ask(store: Store<AppState>, spec: DialogSpec): Promise<{ value: string; input: string }> {
  return new Promise((resolve) => {
    store.set({
      dialog: {
        ...spec,
        resolve: (answer) => {
          store.set({ dialog: undefined });
          resolve(answer);
        },
      },
    });
  });
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function notify(store: Store<AppState>, message: string): void {
  store.set({ notice: message });
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => store.set({ notice: undefined }), 4000);
}
