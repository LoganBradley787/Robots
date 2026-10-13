/** The world's one small status line: the clock, the speed, paused or not, and who the camera is on. */
export function statusLine(seconds: number, timeScale: number, paused: boolean, who: string): string {
  // Whole tenths first, so 59.96 s reads 1:00.0 and never 0:60.0.
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}   x${timeScale}${paused ? '   paused' : ''}   ${who}`;
}

export class Hud {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** `debug`: the raw text (tick, hash, timing). Without it the lines are the one small status line, drawn quieter. */
  set(lines: string[], debug = false): void {
    const text = lines.join('\n');
    if (text !== this.el.textContent) this.el.textContent = text;
    this.el.classList.toggle('debug', debug);
  }
}
