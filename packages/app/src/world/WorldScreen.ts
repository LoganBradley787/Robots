import type { Graphics, Ticker } from 'pixi.js';
import { World, sampleRobot, type PartRegistry, type Robot, type WorldFile } from '@robots/sim-core';
import type { Renderer } from '../render/Renderer';
import { drawDebug } from '../render/DebugDraw';
import { interpolateState } from '../render/interpolate';
import { RobotView } from '../render/RobotView';
import { Effects } from '../render/Effects';
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
import { KeyboardSource } from '../control/KeyboardSource';
import { isClick, nextRobot } from '../control/possession';
import { AUTO_KEYS, buildReplay, type ReplayFile, type ScriptHost } from '@robots/sim-core';

const HELP = 'wheel zoom   drag pan   click a robot to control it   (world controls are on the toolbar below)';

/** One key of the controlled robot, for the keys bar. */
export interface KeyView {
  key: string;
  held: boolean;
  /** Whether a toggle binding on this key is on. */
  on: boolean;
  toggle: boolean;
}

/** What the world toolbar shows. */
export interface WorldView {
  paused: boolean;
  timeScale: number;
  debug: boolean;
  grid: boolean;
  follow: boolean;
  robots: number;
  /** The robot under your control, its keys, and its energy (whole units), or undefined. */
  controlled?: {
    name: string;
    keys: KeyView[];
    energy?: { percent: number; capacity: number };
    /** The robot's scripts: running, off, or stopped with an error. */
    scripts: { id: string; state: 'on' | 'off' | 'crashed'; error?: string }[];
    /** Its latest `log()` lines, oldest first. */
    logs: string[];
  };
  unlimitedEnergy: boolean;
}

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
  /** One view per robot, by robot id. Rebuilt when the robot is (damage, a split), dropped when it is gone. */
  private views = new Map<number, RobotView>();
  private readonly effects = new Effects();
  private readonly stepper: FixedStepper;
  private readonly grid: Graphics;
  private debugVisible = false;
  private lastHash: string;
  /** Key edges for the robot under control. */
  readonly keys = new KeyboardSource();
  /** The robot the camera follows (and controls, when it can be controlled). */
  private focusId: number | undefined;
  private dragging: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
  /** Called when anything the toolbar shows changes. */
  onView?: (v: WorldView) => void;
  /** Called with a short message when something worth telling happens (a robot runs out of energy). */
  onNotice?: (message: string) => void;
  /** How many world events have been shown. */
  private eventCursor = 0;
  private lastView = '';
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
    renderer.world.addChildAt(this.effects.root, renderer.world.getChildIndex(renderer.bodies) + 1);
    renderer.backdrop.addChild(
      this.grid,
      buildTerrainView(file, {
        ground: textures.alias(TERRAIN.ground),
        groundTop: textures.alias(TERRAIN.groundTop),
        block: textures.alias(TERRAIN.block),
      }),
    );
  }

  static async create(renderer: Renderer, textures: GameTextures, file: WorldFile, hud: { set(lines: string[]): void }, scripts: ScriptHost): Promise<WorldScreen> {
    const screen = new WorldScreen(renderer, textures, file, await World.create({ seed: 1, scripts }, file), hud);
    screen.scriptHost = scripts;
    return screen;
  }

  /** Terrain only, no robots. Keeps the camera and time settings. */
  async reset(): Promise<void> {
    const next = await World.create({ seed: 1, ...(this.scriptHost ? { scripts: this.scriptHost } : {}) }, this.file);
    this.world.dispose();
    this.world = next;
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    this.effects.clear();
    this.keys.clear();
    this.focusId = undefined;
    this.eventCursor = 0;
    next.setUnlimitedEnergy(this.unlimitedWanted);
    this.home();
    this.lastHash = next.hash();
    this.stepper.reset();
  }

  spawn(raw: unknown, at: { x: number; y: number }): Robot {
    const robot = this.world.spawnBlueprint(raw, at);
    this.syncViews();
    this.focus(robot.id);
    return robot;
  }

  /** Clears debris (M6): every robot nobody can control goes on the next tick. */
  clearDebris(): void {
    this.world.clearDebris();
  }

  /** Views follow the robots: new pieces get one, rebuilt robots get a fresh one, removed robots lose theirs. */
  private syncViews(): void {
    const live = new Set(this.world.robots.map((r) => r.id));
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      v.root.destroy({ children: true });
      this.views.delete(id);
    }
    for (const robot of this.world.robots) {
      const old = this.views.get(robot.id);
      if (old && old.version === robot.version) continue;
      const view = new RobotView(robot, (f) => this.textures.part(f), (name) => this.textures.fx.animations[name] ?? []);
      if (old) {
        this.renderer.bodies.addChildAt(view.root, this.renderer.bodies.getChildIndex(old.root));
        old.root.destroy({ children: true });
      } else {
        this.renderer.bodies.addChild(view.root);
      }
      this.views.set(robot.id, view);
    }
  }

  /**
   * Follows the robot and takes control of it when it has a core (`11`). Watching a core-less robot lets go of the
   * one you were controlling (it latches), so your keys never drive a robot you cannot see.
   */
  focus(robotId: number): void {
    this.focusId = robotId;
    this.cam = setFollow(this.cam, true);
    this.keys.setControlled(this.world.canControl(robotId) ? robotId : undefined);
  }

  /** Back to where robots drop in, following nothing: for when you are lost (Gate 3). */
  home(): void {
    this.focusId = undefined;
    this.cam = { ...createCamera(this.file.spawn.x, this.file.spawn.y - 3), zoom: this.cam.zoom };
  }

  private scriptHost: ScriptHost | undefined;

  /** Survives Clear robots: the new world starts with the same switch. */
  private unlimitedWanted = false;

  toggleUnlimitedEnergy(): void {
    this.unlimitedWanted = !this.world.unlimitedEnergy;
    this.world.setUnlimitedEnergy(this.unlimitedWanted);
  }

  get controlledId(): number | undefined {
    return this.keys.robot;
  }

  /** The session since the last clear, as a replay file, and the robot you were controlling. */
  replay(): { replay: ReplayFile; robot?: string } {
    const robot = this.world.robots.find((r) => r.id === this.keys.robot)?.name;
    return { replay: buildReplay(this.world), ...(robot !== undefined ? { robot } : {}) };
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
      camera: () => {
        if (!this.cam.follow) {
          this.cam = setFollow(this.cam, true);
          return;
        }
        const next = nextRobot(
          this.world.robots.map((r) => ({ id: r.id, controllable: this.world.canControl(r.id) })),
          this.focusId,
        );
        if (next !== undefined) this.focus(next);
        else this.home();
      },
      toggleGrid: () => {
        this.grid.visible = !this.grid.visible;
      },
      reset: () => void this.reset(),
      home: () => this.home(),
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
    this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
  }

  onPointerMove(e: PointerEvent, sx: number, sy: number): void {
    if (this.placing) this.updateGhost(sx, sy);
    if (!this.dragging || e.pointerId !== this.dragging.id) return;
    this.cam = panByPixels(this.cam, e.clientX - this.dragging.x, e.clientY - this.dragging.y);
    this.dragging = { ...this.dragging, x: e.clientX, y: e.clientY };
  }

  /** A click (not a drag) on a robot takes control of it. */
  onPointerUp(e: PointerEvent, sx: number, sy: number): void {
    const d = this.dragging;
    if (!d || e.pointerId !== d.id) return;
    this.dragging = null;
    if (e.button !== 0 || !isClick({ x: d.startX, y: d.startY }, { x: e.clientX, y: e.clientY })) return;
    const p = screenToWorld(this.cam, sx, sy, this.renderer.screenWidth, this.renderer.screenHeight);
    const body = this.world.physics.dynamicBodyAt(p.x, p.y);
    const robot = body === undefined ? undefined : this.world.robots.find((r) => r.groups.some((g) => g.bodyId === body));
    if (robot) {
      // A click drags the camera by a pixel or two; undo that so the robot does not jump.
      this.cam = panByPixels(this.cam, d.startX - e.clientX, d.startY - e.clientY);
      this.focus(robot.id);
    }
  }

  frame(ticker: Ticker): void {
    const time = this.time;
    let ticks = time.takePendingSteps();
    if (time.paused) this.stepper.reset();
    else ticks += this.stepper.advance(ticker.deltaMS, time.timeScale);
    for (let i = 0; i < ticks; i++) {
      // Keys are sampled once per tick: this frame's edges go into its first tick. While paused they wait.
      this.world.step(i === 0 ? this.keys.drain() : []);
      if (this.world.tick % 60 === 0) this.lastHash = this.world.hash();
    }

    if (ticks > 0) this.syncViews();
    // A robot whose core was destroyed cannot be driven any more: let go of it (the world would drop the keys anyway).
    if (this.keys.robot !== undefined && !this.world.canControl(this.keys.robot)) this.keys.setControlled(undefined);
    const alpha = time.paused ? 1 : this.stepper.alpha;
    for (const [id, v] of this.views) {
      // A part that needs energy only looks busy (flame, spinning blades) while its robot has some to give.
      const powered = this.world.unlimitedEnergy || (this.world.energy(id)?.stored ?? 0) > 0;
      const robot = this.world.robots.find((r) => r.id === id);
      v.sync(this.world.physics, alpha, (partId, channel) =>
        !powered && (robot?.parts.get(partId)?.def.powerDraw ?? 0) > 0 ? 0 : this.world.channelValue(id, partId, channel),
      );
    }
    this.effects.update(time.paused ? 0 : (ticker.deltaMS / 1000) * time.timeScale);
    const focus = this.world.robots.find((r) => r.id === this.focusId);
    if (focus) this.cam = followTarget(this.cam, anchorPosition(this.world, focus, alpha), ticker.deltaMS / 1000);
    applyCamera(this.renderer.world, this.cam, this.renderer.screenWidth, this.renderer.screenHeight);
    if (this.debugVisible) drawDebug(this.renderer.debug, this.world.physics.debugRender(), true);
    else this.renderer.debug.clear();

    const s = focus ? sampleRobot(this.world, focus) : undefined;
    const controlled = this.keys.robot === undefined ? undefined : this.world.robots.find((r) => r.id === this.keys.robot);
    const robotLine =
      focus && s
        ? `${focus.id === controlled?.id ? 'controlling' : 'watching'} ${focus.name} (${this.world.robots.indexOf(focus) + 1}/${this.world.robots.length})   ${s.speed.toFixed(1)} m/s   core (${s.coreX.toFixed(2)}, ${s.coreY.toFixed(2)})   tilt ${s.tiltDeg.toFixed(1)}   ${s.resting ? 'resting' : 'moving'}   ${s.massKg.toFixed(1)} kg`
        : this.world.robots.length > 0
          ? 'following no robot: click one, or press , for the next'
          : 'no robots yet: build one and press Deploy';
    const p = this.placing;
    const placingLines = p
      ? [`PLACING ${p.ghost.name}: click to drop   Esc cancels   ${p.ok ? 'fits here' : `blocked: ${p.reason ?? 'move the cursor into the world'}`}`]
      : [];
    const view: WorldView = {
      paused: time.paused,
      timeScale: time.timeScale,
      debug: this.debugVisible,
      grid: this.grid.visible,
      follow: this.cam.follow,
      robots: this.world.robots.length,
      unlimitedEnergy: this.world.unlimitedEnergy,
    };
    for (; this.eventCursor < this.world.events.length; this.eventCursor++) {
      const ev = this.world.events[this.eventCursor];
      const who = this.world.robots.find((r) => r.id === ev?.robot);
      if (ev?.kind === 'energyEmpty' && who) this.onNotice?.(`${who.name} ran out of energy`);
      if (ev?.kind === 'scriptCrashed' && who) this.onNotice?.(`${who.name}: script "${ev.script}" stopped. ${ev.error.message}`);
      if (ev?.kind === 'explosion') this.effects.explosion(ev.x, ev.y, ev.radius);
      if (ev?.kind === 'decoupled') this.effects.spark(ev.x, ev.y);
      // A part that explodes gets the blast instead of a puff.
      if (ev?.kind === 'partDestroyed' && !this.world.registry.get(ev.partType).onDestroyed?.explode) this.effects.breakPuff(ev.x, ev.y);
      if (ev?.kind === 'coreLost' && who) this.onNotice?.(`${who.name} lost its core: nobody controls it now, and it keeps doing what it was doing`);
      if (ev?.kind === 'coreWoke' && who) this.onNotice?.(`A core woke up in a piece that broke off ${who.name}: click it to control it`);
    }
    const controller = controlled ? this.world.controller(controlled.id) : undefined;
    if (controlled && controller) {
      // A key bound to a script is a toggle too, lit while any of its scripts runs.
      const scripts = this.world.scripts(controlled.id);
      const scriptKeys = new Map<string, string[]>();
      // A core that woke in a broken-off piece has only auto controls: its blueprint's script keys are not its own.
      if (!controlled.woke) for (const b of controlled.blueprint.bindings) if (b.mode === 'script' && b.script !== undefined) scriptKeys.set(b.key, [...(scriptKeys.get(b.key) ?? []), b.script]);
      const toggles = new Set([...controller.toggleKeys, ...scriptKeys.keys()]);
      const scriptOn = (key: string): boolean => (scriptKeys.get(key) ?? []).some((id) => scripts.find((s) => s.id === id)?.enabled === true);
      // Auto control keys first (Q W E A S D), then custom keys in binding order.
      const rank = (k: string): number => (AUTO_KEYS.includes(k) ? AUTO_KEYS.indexOf(k) : AUTO_KEYS.length);
      const keys = controller.keys.map((key, i) => ({ key, i })).sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i);
      const e = this.world.energy(controlled.id);
      view.controlled = {
        name: controlled.name,
        // Whole percent only: the view is compared every frame, and a finer number would re-render the UI every tick.
        ...(e ? { energy: { percent: e.capacity > 0 ? Math.ceil((100 * e.stored) / e.capacity) : 0, capacity: e.capacity } } : {}),
        scripts: scripts.map((s) => ({ id: s.id, state: s.enabled ? 'on' : s.crashed ? 'crashed' : 'off', ...(s.crashed ? { error: s.crashed.message } : {}) })),
        logs: this.world.scriptLogs
          .filter((l) => l.robot === controlled.id)
          .slice(-5)
          .map((l) => `${l.script}: ${l.text}`),
        keys: keys.map(({ key }) => ({
          key,
          // Lit as soon as it is pressed, even while paused; the sim catches up on the next tick.
          held: controller.isHeld(key) || this.keys.isDown(key),
          on: controller.isToggledOn(key) || scriptOn(key),
          toggle: toggles.has(key),
        })),
      };
    }
    const key = JSON.stringify(view);
    if (key !== this.lastView) {
      this.lastView = key;
      this.onView?.(view);
    }
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
