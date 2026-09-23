import { Application, Container, Graphics } from 'pixi.js';

export class Renderer {
  readonly app = new Application();
  /** Everything in world space goes in here; the camera transforms this container. */
  readonly world = new Container();
  /** Layers inside the world, back to front: grid and terrain, robots, debug outlines. */
  readonly backdrop = new Container();
  readonly bodies = new Container();
  readonly debug = new Graphics();

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: 0x141a22,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.backdrop, this.bodies, this.debug);
  }

  get screenWidth(): number {
    return this.app.screen.width;
  }

  get screenHeight(): number {
    return this.app.screen.height;
  }
}
