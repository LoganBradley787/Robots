import { Container, Sprite, type Texture } from 'pixi.js';
import type { BodyId, PhysicsWorld, Robot } from '@robots/sim-core';
import { interpolateState } from './interpolate';
import { layoutRobot } from './robotLayout';
import { PIXELS_PER_METER, toScreen, toScreenAngle } from './units';

/** One Container per rigid body, one Sprite per part at its body-local offset. Only containers move per frame. */
export class RobotView {
  readonly root = new Container();
  private readonly bodies: { bodyId: BodyId; view: Container }[] = [];

  constructor(robot: Robot, frame: (name: string) => Texture) {
    for (const body of layoutRobot(robot)) {
      const view = new Container();
      for (const s of body.sprites) {
        const sprite = new Sprite(frame(s.frame));
        sprite.anchor.set(0.5);
        sprite.width = PIXELS_PER_METER;
        sprite.height = PIXELS_PER_METER;
        const p = toScreen(s);
        sprite.position.set(p.x, p.y);
        sprite.rotation = toScreenAngle(s.rotation);
        view.addChild(sprite);
      }
      this.root.addChild(view);
      this.bodies.push({ bodyId: body.bodyId, view });
    }
  }

  sync(physics: PhysicsWorld, alpha: number): void {
    for (const b of this.bodies) {
      const s = interpolateState(physics.prevState(b.bodyId), physics.state(b.bodyId), alpha);
      const p = toScreen(s);
      b.view.position.set(p.x, p.y);
      b.view.rotation = toScreenAngle(s.angle);
    }
  }
}
