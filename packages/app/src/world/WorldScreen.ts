import type { Graphics, Ticker } from 'pixi.js';
import { World, sampleRobot, type PartRegistry, type Robot, type WorldFile } from '@robots/sim-core';
import type { Renderer } from '../render/Renderer';
import { drawDebug } from '../render/DebugDraw';
import { interpolateState } from '../render/interpolate';
import { RobotView } from '../render/RobotView';
import { buildTerrainView } from '../render/TerrainView';
import { buildGridView } from '../render/GridView';
import { TERRAIN } from '../render/assetKeys';
import type { GameTextures } from '../render/assets';
import { createCamera, followTarget, panByPixels, screenToWorld, setFollow, zoomBy, type CameraState } from '../render/camera';
import { SpawnGhost } from './SpawnGhost';
import { snapDrop } from '../builder/deployFlow';
import { applyCamera } from '../render/cameraView';
import { FixedStepper } from '../app/FixedStepper';
import { TimeControls } from '../app/TimeControls';
import type { KeyActions } from '../app/keys';

const HELP = 'Tab builder   Space pause   . step   [ ] speed   F follow   C next robot   D debug   G grid   R reset   wheel zoom   drag pan';

/** Interpolated world position of the robot's core (or root part), for the camera. */
function anchorPosition(world: World, robot: Robot, alpha: number): { x: number; y: number } {
  const part = robot.parts.get(robot.primaryCoreId ?? robot.rootId);
  const group = part ? robot.groups[part.group] : undefined;
  if (!part || !group) return { x: robot.spawnX, y: robot.spawnY };
  const s = interpolateState(world.physics.prevState(group.bodyId), world.physics.state(group.bodyId), alpha);
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.x + c * part.localX - n * part.localY, y: s.y + n * part.localX + c * part.localY };
}

/** The world screen: the simulation, its views, camera, time controls, and HUD. */
export class WorldScreen {
  world: World;
  readonly time = new TimeControls();
  cam: CameraState;
  private views: RobotView[] = [];
  private readonly stepper: FixedStepper;
  private readonly grid: Graphics;
  private debugVisible = false;
  private lastHash: string;
  private targetIndex = 0;
  private dragging: { id: number; x: number; y: number } | null = null;
  /** A blueprint waiting to be dropped, following the cursor. */
  private placing?: { ghost: SpawnGhost; at?: { x: number; y: number }; ok: boolean; reason?: string };

  private readonly renderer: Renderer;
  private readonly textures: GameTextures;
  private readonly file: WorldFile;
  private readonly hud: { set(lines: string[]): void };

  private constructor(renderer: Renderer, textures: GameTextures, file: WorldFile, world: World, hud: { set(lines: string[]): void }) {
    this.renderer = renderer;
    this.textures = textures;
    this.file = file;
    this.hud = hud;
    this.world = world;
    this.cam = createCamera(file.spawn.x, file.spawn.y - 3);
    this.stepper = new FixedStepper(1000 * world.dt);
    this.lastHash = world.hash();
    this.grid = buildGridView({ minX: -60, maxX: 60, minY: -2, maxY: 30 });
    renderer.backdrop.addChild(
      this.grid,
      buildTerrainView(file, {
        ground: textures.alias(TERRAIN.ground),
        groundTop: textures.alias(TERRAIN.groundTop),
        block: textures.alias(TERRAIN.block),
      }),
    );
  }

  static async create(renderer: Renderer, textures: GameTextures, file: WorldFile, hud: { set(lines: string[]): void }): Promise<WorldScreen> {
    return new WorldScreen(renderer, textures, file, await World.create({ seed: 1 }, file), hud);
  }

  /** Terrain only, no robots. Keeps the camera and time settings. */
  async reset(): Promise<void> {
    const next = await World.create({ seed: 1 }, this.file);
    this.world.dispose();
    this.world = next;
    for (const v of this.views) v.root.destroy({ children: true });
    this.views = [];
    this.targetIndex = 0;
    this.lastHash = next.hash();
    this.stepper.reset();
  }

  spawn(raw: unknown, at: { x: number; y: number }): Robot {
    const robot = this.world.spawnBlueprint(raw, at);
    const view = new RobotView(robot, (f) => this.textures.part(f));
    this.renderer.bodies.addChild(view.root);
    this.views.push(view);
    this.targetIndex = this.world.robots.length - 1;
    this.cam = setFollow(this.cam, true);
    return robot;
  }

  get isPlacing(): boolean {
    return this.placing !== undefined;
  }

  /** Shows a ghost of the blueprint on the cursor until a click drops it or Esc cancels. */
  startPlacing(raw: unknown, registry: PartRegistry): void {
    this.cancelPlacing();
    const ghost = new SpawnGhost(raw, registry, (f) => this.textures.part(f));
    ghost.root.visible = false;
    this.renderer.bodies.addChild(ghost.root);
    this.placing = { ghost, ok: false };
    this.cam = setFollow(this.cam, false);
  }

  cancelPlacing(): void {
    this.placing?.ghost.destroy();
    this.placing = undefined;
  }

  private updateGhost(sx: number, sy: number): void {
    const p = this.placing;
    if (!p) return;
    const at = snapDrop(screenToWorld(this.cam, sx, sy, this.renderer.screenWidth, this.renderer.screenHeight));
    const check = this.world.canPlace(p.ghost.raw, at);
    this.placing = { ...p, at, ok: check.ok, ...(check.reason !== undefined ? { reason: check.reason } : {}) };
    p.ghost.root.visible = true;
    p.ghost.place(at, check.ok);
  }

  keyActions(): KeyActions {
    return {
      togglePause: () => {
        this.time.togglePause();
        if (!this.time.paused) this.stepper.resume();
      },
      step: () => this.time.requestStep(),
      faster: () => this.time.faster(),
      slower: () => this.time.slower(),
      toggleDebug: () => {
        this.debugVisible = !this.debugVisible;
      },
      toggleFollow: () => {
        this.cam = setFollow(this.cam, !this.cam.follow);
      },
      cycleTarget: () => {
        if (this.world.robots.length === 0) return;
        this.targetIndex = (this.targetIndex + 1) % this.world.robots.length;
        this.cam = setFollow(this.cam, true);
      },
      toggleGrid: () => {
        this.grid.visible = !this.grid.visible;
      },
      reset: () => void this.reset(),
    };
  }

  setPaused(paused: boolean): void {
    if (this.time.paused === paused) return;
    this.time.paused = paused;
    if (paused) this.stepper.reset();
    else this.stepper.resume();
  }

  onWheel(e: WheelEvent): void {
    this.cam = zoomBy(this.cam, Math.exp(-e.deltaY * 0.0015));
  }

  onPointerDown(e: PointerEvent, sx: number, sy: number): void {
    if (this.placing && e.button === 0) {
      this.updateGhost(sx, sy);
      const p = this.placing;
      if (p?.ok && p.at) {
        this.cancelPlacing();
        this.spawn(p.ghost.raw, p.at);
      }
      return;
    }
    this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  onPointerMove(e: PointerEvent, sx: number, sy: number): void {
    if (this.placing) this.updateGhost(sx, sy);
    if (!this.dragging || e.pointerId !== this.dragging.id) return;
    this.cam = panByPixels(this.cam, e.clientX - this.dragging.x, e.clientY - this.dragging.y);
    this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  onPointerUp(e: PointerEvent): void {
    if (this.dragging && e.pointerId === this.dragging.id) this.dragging = null;
  }

  frame(ticker: Ticker): void {
    const time = this.time;
    let ticks = time.takePendingSteps();
    if (time.paused) this.stepper.reset();
    else ticks += this.stepper.advance(ticker.deltaMS, time.timeScale);
    for (let i = 0; i < ticks; i++) {
      this.world.step();
      if (this.world.tick % 60 === 0) this.lastHash = this.world.hash();
    }

    const alpha = time.paused ? 1 : this.stepper.alpha;
    for (const v of this.views) v.sync(this.world.physics, alpha);
    const focus = this.world.robots[this.targetIndex];
    if (focus) this.cam = followTarget(this.cam, anchorPosition(this.world, focus, alpha), ticker.deltaMS / 1000);
    applyCamera(this.renderer.world, this.cam, this.renderer.screenWidth, this.renderer.screenHeight);
    if (this.debugVisible) drawDebug(this.renderer.debug, this.world.physics.debugRender(), true);
    else this.renderer.debug.clear();

    const s = focus ? sampleRobot(this.world, focus) : undefined;
    const robotLine =
      focus && s
        ? `robot ${focus.name} (${this.targetIndex + 1}/${this.world.robots.length})   core (${s.coreX.toFixed(2)}, ${s.coreY.toFixed(2)})   tilt ${s.tiltDeg.toFixed(1)}   ${s.resting ? 'resting' : 'moving'}   ${s.massKg.toFixed(1)} kg`
        : 'no robots yet: build one and press Deploy';
    const p = this.placing;
    const placingLines = p
      ? [`PLACING ${p.ghost.name}: click to drop   Esc cancels   ${p.ok ? 'fits here' : `blocked: ${p.reason ?? 'move the cursor into the world'}`}`]
      : [];
    this.hud.set([
      `tick ${this.world.tick}   t=${this.world.time.toFixed(2)}s   ${Math.round(ticker.FPS)} fps`,
      `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}   zoom ${this.cam.zoom.toFixed(2)}   follow ${this.cam.follow ? 'on' : 'off'}`,
      robotLine,
      ...placingLines,
      `hash ${this.lastHash}`,
      HELP,
    ]);
  }
}
