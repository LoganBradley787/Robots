export class Hud {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(lines: string[]): void {
    this.el.textContent = lines.join('\n');
  }
}
