/**
 * A card in the middle of the screen while something slow gets ready (a duel from the page address). Plain DOM, not a
 * Preact component, so it shows from the first moment of boot, long before the app's UI is mounted.
 */
export interface LoadingCard {
  /** Shows what is being done now and waits until the browser has painted it, so the page never looks frozen. */
  step(text: string): Promise<void>;
  /** Shows the error in place of the steps, with a button that closes the card. */
  fail(message: string): void;
  /** Takes the card away. */
  done(): void;
}

/**
 * Resolves after the browser has painted the next frame. A tab in the background paints no frames at all, so a timer
 * goes on without one after 100 ms: a duel opened in a background tab still loads.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let gone = false;
    const go = (): void => {
      if (gone) return;
      gone = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 100);
  });
}

export function showLoading(title: string): LoadingCard {
  const backdrop = document.createElement('div');
  backdrop.className = 'loading-backdrop';
  const card = document.createElement('div');
  card.className = 'loading-card plate float';
  card.setAttribute('role', 'status');
  const head = document.createElement('h2');
  head.textContent = title;
  const line = document.createElement('p');
  line.className = 'loading-step';
  card.append(head, line);
  backdrop.append(card);
  document.body.append(backdrop);
  const started = performance.now();
  return {
    async step(text) {
      // The time since the card opened, so a long step reads as working, not stuck.
      line.textContent = `${text}... (${((performance.now() - started) / 1000).toFixed(1)} s)`;
      // In the browser's performance timeline too, to tell which step is slow.
      performance.mark(`loading: ${text}`);
      await nextPaint();
    },
    fail(message) {
      card.classList.add('failed');
      head.textContent = `${title}: failed`;
      card.setAttribute('role', 'alert');
      line.className = 'loading-error';
      line.textContent = message;
      const close = document.createElement('button');
      close.className = 'btn';
      close.textContent = 'Close';
      close.addEventListener('click', () => backdrop.remove());
      const row = document.createElement('div');
      row.className = 'dialog-buttons';
      row.append(close);
      card.append(row);
      close.focus();
    },
    done() {
      performance.mark('loading: done');
      backdrop.remove();
    },
  };
}
