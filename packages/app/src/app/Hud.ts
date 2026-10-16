/** The world's clock as the time panel shows it: minutes, seconds and tenths. */
export function clockText(seconds: number): string {
  // Whole tenths first, so 59.96 s reads 1:00.0 and never 0:60.0.
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** A speed of the table as the time panel says it: "x1/4", "x1/2", "x1", "x2", "x4". */
export function speedText(scale: number): string {
  return scale >= 1 ? `x${scale}` : `x1/${Math.round(1 / scale)}`;
}

/**
 * The text at the top left of the world under the time panel: with Debug on the raw text (tick, hash, timing), else
 * only the lines that say how to place a held robot.
 */
export class Hud {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(lines: string[], debug = false): void {
    const text = lines.join('\n');
    if (text !== this.el.textContent) this.el.textContent = text;
    this.el.classList.toggle('debug', debug);
  }
}
