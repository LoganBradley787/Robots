import { clockText } from '../app/Hud';
import { Graphics, type Ticker } from 'pixi.js';
import { World, activeControls, keysScriptsRead, orientRaw, partWorldPose, rotateCell, sampleRobot, type PartRegistry, type Robot, type ScriptSpec, type WorldFile } from '@robots/sim-core';
import type { Renderer } from '../render/Renderer';
import { drawDebug } from '../render/DebugDraw';
import { drawSensors, type SensorOverlay } from '../render/SensorDraw';
import { interpolateState } from '../render/interpolate';
import { RobotView } from '../render/RobotView';
import { SoundScene } from '../audio/SoundScene';
import { Effects } from '../render/Effects';
import { ShellsView } from '../render/ShellsView';
import { BeamsView } from '../render/BeamsView';
import { BoltsView } from '../render/BoltsView';
import { SmokeView } from '../render/SmokeView';
import { RopesView } from '../render/RopesView';
import { buildTerrainView } from '../render/TerrainView';
import { buildGridView } from '../render/GridView';
import { TERRAIN } from '../render/assetKeys';
import type { GameTextures } from '../render/assets';
import { createCamera, followTarget, panByPixels, screenToWorld, setFollow, zoomBy, type CameraState } from '../render/camera';
import { SpawnGhost } from './SpawnGhost';
import { placePress, placingLine } from './placing';
import { snapDrop } from '../builder/deployFlow';
import { applyCamera } from '../render/cameraView';
import { PIXELS_PER_METER, toScreen } from '../render/units';
import { FixedStepper } from '../app/FixedStepper';
import { runWithin, SIM_BUDGET_MS } from '../app/tickBudget';
import { TimeControls } from '../app/TimeControls';
import type { KeyActions } from '../app/keys';
import { KeyboardSource } from '../control/KeyboardSource';
import { canPossess, isClick, nextRobot } from '../control/possession';
import { PerfMeter } from '../app/perfMeter';
import type { ScriptClock } from '../app/timedHost';
import { msText, ScriptCosts } from '../app/scriptCosts';
import { placeGrid, surfaceAt, type StressGrid } from './stress';
import { flipped, loadDeploySettings, nextTeam, saveDeploySettings, teamName, turned, type DeploySettings, type SettingsStore } from './deploySettings';
import { AUTO_KEYS, buildReplay, type ReplayFile, type ScriptHost } from '@robots/sim-core';
import { buildReadout, type ReadoutView } from './readout';
import { farIds, loadFarDistance, outlineEdges, saveFarDistance, teamCounts, teamIds, type Edge, type RobotSpot } from './removal';

const HELP = 'wheel zoom   drag pan   click a robot to control it   (time controls in the panel above, the rest on the bar below)';

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
  /** M16, the time panel: who you control or watch, in a few words ("controlling Car", "watching enemy Drone"). */
  who: string;
  debug: boolean;
  grid: boolean;
  follow: boolean;
  robots: number;
  /** Which side the next deploy joins (M8). */
  deployTeam: number;
  /** M15: the sound controls. `awake` is false until a first click or key press lets the browser start audio. */
  sound: { muted: boolean; volume: number; delay: boolean; awake: boolean };
  /** The robot under your control, its keys, and its energy (whole units), or undefined. */
  controlled?: {
    name: string;
    keys: KeyView[];
    /** Keys its running scripts read (M7): no binding, but they do something. */
    scriptKeys: { key: string; held: boolean }[];
    energy?: { percent: number; capacity: number };
    /** The robot's scripts: running, off, or stopped with an error. */
    scripts: { id: string; state: 'on' | 'off' | 'crashed'; error?: string }[];
    /** Its latest `log()` lines, oldest first. */
    logs: string[];
  };
  unlimitedEnergy: boolean;
  /** M16: whether a click removes the robot under it (the bar's Remove button). */
  removing: boolean;
  /** M16: robots per team, for the Sandbox menu's Remove all rows; teams with none are left out. */
  teams: { team: number; count: number }[];
  /** M16: Remove far away's distance (meters from the middle of the world), and how many robots are past it now. */
  far: { distance: number; count: number };
  /**
   * M16, the live readout of the robot you control or watch: its scripts and, while the readout is open, what they
   * set and who drives each input. Absent when no robot is followed.
   */
  readout?: ReadoutView;
  readoutOpen: boolean;
}

const READOUT_KEY = 'robots.readout';

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
  /** M15: the world's sound. It only listens. */
  readonly sound: SoundScene;
  private readonly shells = new ShellsView();
  private readonly beams = new BeamsView();
  private readonly bolts = new BoltsView();
  /** M14: screen pixels the camera shakes by, dying away (a laser blowing up on screen). */
  private shake = 0;
  private readonly smoke = new SmokeView();
  private readonly ropes = new RopesView();
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
  /** The time panel's clock ("1:15.0"), called only when the text changes, so only the panel redraws ten times a second. */
  onClock?: (text: string) => void;
  private lastClock = '';
  /** Called with a short message when something worth telling happens (a robot runs out of energy). */
  onNotice?: (message: string) => void;
  /** Called after every simulated tick (the duel view judges the match here). */
  afterStep?: () => void;
  /** How many world events have been shown. */
  private eventCursor = 0;
  private lastView = '';
  /** M16: whether the live readout is open. Only then does the world keep a trace. Kept in the browser. */
  private readoutOpen = false;
  /** The readout as last worked out, and for which tick of which robot: it is made a few times a second, not every frame. */
  private readoutAt: { robot: number; tick: number; open: boolean; held: string; view: ReadoutView } | undefined;
  /** Keys each script source reads, cached by source (it only changes when the robot is redeployed). */
  private readonly readCache = new Map<string, Set<string>>();
  /** A blueprint waiting to be dropped, following the cursor. */
  private placing?: { ghost: SpawnGhost; source: unknown; registry: PartRegistry; at?: { x: number; y: number }; ok: boolean; reason?: string };
  /** Team, flip, and turn for the next deploy (M8). They stick, saved in the browser. */
  private deploy: DeploySettings;
  private readonly settingsStore: SettingsStore | undefined;
  /** M16: the remove cursor is armed, the robot under it (outlined in orange), and Remove far away's distance. */
  private removeArmed = false;
  private hoverId: number | undefined;
  /** Where the pointer last was over the world (screen pixels), so the remove cursor's robot is found again every frame. */
  private pointer: { sx: number; sy: number } | undefined;
  private farDistance: number;
  /** The orange outline over the robot a click would remove, with its edges per body, made again when the robot is. */
  private readonly outline = new Graphics();
  private outlineOf: { id: number; version: number; bodies: Edge[][] } | undefined;

  private readonly renderer: Renderer;
  private readonly textures: GameTextures;
  private readonly file: WorldFile;
  private readonly hud: { set(lines: string[], debug?: boolean): void };

  private scriptKeysOf(scripts: readonly ScriptSpec[]): Set<string> {
    const out = new Set<string>();
    for (const sc of scripts) {
      if (typeof sc.source !== 'string') continue;
      let keys = this.readCache.get(sc.source);
      if (!keys) {
        keys = keysScriptsRead([sc.source]).keys;
        this.readCache.set(sc.source, keys);
      }
      for (const k of keys) out.add(k);
    }
    return out;
  }

  private constructor(renderer: Renderer, textures: GameTextures, file: WorldFile, world: World, hud: { set(lines: string[], debug?: boolean): void }) {
    this.renderer = renderer;
    this.textures = textures;
    this.file = file;
    this.hud = hud;
    this.world = world;
    this.settingsStore = browserStorage();
    this.deploy = loadDeploySettings(this.settingsStore);
    this.farDistance = loadFarDistance(this.settingsStore);
    this.sound = new SoundScene(this.settingsStore);
    this.readoutOpen = this.settingsStore?.getItem(READOUT_KEY) === 'open';
    this.cam = createCamera(file.spawn.x, file.spawn.y - 3);
    this.stepper = new FixedStepper(1000 * world.dt);
    world.watchScripts(this.watch);
    this.lastHash = world.hash();
    this.grid = buildGridView({ minX: -60, maxX: 60, minY: -2, maxY: 30 });
    renderer.world.addChildAt(this.effects.root, renderer.world.getChildIndex(renderer.bodies) + 1);
    renderer.world.addChildAt(this.shells.root, renderer.world.getChildIndex(this.effects.root) + 1);
    renderer.world.addChildAt(this.smoke.root, renderer.world.getChildIndex(this.shells.root) + 1);
    renderer.world.addChildAt(this.ropes.root, renderer.world.getChildIndex(this.shells.root) + 1);
    // Beams glow over smoke and ropes.
    renderer.world.addChildAt(this.beams.root, renderer.world.getChildIndex(this.smoke.root) + 1);
    renderer.world.addChildAt(this.bolts.root, renderer.world.getChildIndex(this.beams.root) + 1);
    renderer.world.addChildAt(this.outline, renderer.world.getChildIndex(this.bolts.root) + 1);
    renderer.backdrop.addChild(
      this.grid,
      buildTerrainView(file, {
        ground: textures.alias(TERRAIN.ground),
        groundTop: textures.alias(TERRAIN.groundTop),
        block: textures.alias(TERRAIN.block),
      }),
    );
  }

  static async create(renderer: Renderer, textures: GameTextures, file: WorldFile, hud: { set(lines: string[], debug?: boolean): void }, scripts: ScriptHost, clock?: ScriptClock): Promise<WorldScreen> {
    const screen = new WorldScreen(renderer, textures, file, await World.create({ seed: 1, scripts }, file), hud);
    screen.scriptHost = scripts;
    screen.clock = clock;
    return screen;
  }

  /** Time spent in scripts (M9: the script host is wrapped in a timer), and the readout it feeds. */
  private clock: ScriptClock | undefined;
  private readonly perf = new PerfMeter();
  /** Each robot's scripts, timed on this machine's clock (`World.watchScripts`), for the readout. */
  private readonly costs = new ScriptCosts();
  private readonly watch = (robot: number, run: () => void): void => {
    const t = performance.now();
    run();
    this.costs.add(robot, performance.now() - t);
  };

  /**
   * Stress test (M9): drops copies of `raw` in rows around `centerX` (the middle of the screen by default), skipping
   * spots that are taken or have no ground under them. Robots are placed like any deploy, so they are in the replay
   * and Clear robots removes them. Returns how many were placed.
   */
  stress(raw: unknown, team: number, grid: StressGrid, offsetX = 0): number {
    const placed = placeGrid({ x: this.cam.x + offsetX }, grid, (x) => surfaceAt(this.file, x), (at) => {
      if (!this.world.canPlace(raw, at).ok) return false;
      this.world.spawnBlueprint(raw, at, { team });
      return true;
    });
    this.syncViews();
    this.cam = setFollow(this.cam, false);
    return placed.length;
  }

  /** Terrain only, no robots. Keeps the camera and time settings. */
  async reset(): Promise<void> {
    const next = await World.create({ seed: 1, ...(this.scriptHost ? { scripts: this.scriptHost } : {}) }, this.file);
    this.world.dispose();
    this.world = next;
    next.watchScripts(this.watch);
    this.costs.clear();
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    this.effects.clear();
    this.beams.clear();
    this.bolts.clear();
    this.sound.clear();
    this.keys.clear();
    this.focusId = undefined;
    this.hoverId = undefined;
    this.outlineOf = undefined;
    this.eventCursor = 0;
    next.setUnlimitedEnergy(this.unlimitedWanted);
    this.home();
    this.lastHash = next.hash();
    this.stepper.reset();
  }

  spawn(raw: unknown, at: { x: number; y: number }, team = 0): Robot {
    const robot = this.world.spawnBlueprint(raw, at, { team });
    this.syncViews();
    // Deploying an enemy while you drive one of yours keeps you on yours (M8 review): switching would let go of it with
    // its keys still held.
    if (this.possessable(robot.id) || this.keys.robot === undefined) this.focus(robot.id);
    return robot;
  }

  /** Clears debris (M6): every robot nobody can control goes on the next tick. */
  clearDebris(): void {
    this.world.clearDebris();
  }

  /**
   * M16: removes robots by id on the next tick (the world logs it for replays). Their views hide at once, so a removal
   * while paused shows; one you control lets go of your keys now. Returns how many were not already going.
   */
  removeRobots(ids: readonly number[]): number {
    const fresh = ids.filter((id) => this.world.robotById(id) !== undefined && !this.world.removing(id));
    if (fresh.length === 0) return 0;
    this.world.removeRobots(fresh);
    const gone = new Set(fresh);
    if (this.keys.robot !== undefined && gone.has(this.keys.robot)) this.keys.setControlled(undefined);
    if (this.focusId !== undefined && gone.has(this.focusId)) {
      this.focusId = undefined;
      this.cam = setFollow(this.cam, false);
    }
    for (const id of fresh) {
      const v = this.views.get(id);
      if (v) v.root.visible = false;
    }
    return fresh.length;
  }

  /** Robots still in the world: not waiting to be removed. */
  private present(): Robot[] {
    return this.world.robots.filter((r) => !this.world.removing(r.id));
  }

  /** Where a robot is for Remove far away: its core, or the middle of a piece with none. */
  private spot(robot: Robot): RobotSpot {
    const s = sampleRobot(this.world, robot);
    return robot.primaryCoreId !== undefined ? { id: robot.id, x: s.coreX, y: s.coreY } : { id: robot.id, x: s.comX, y: s.comY };
  }

  /** How many robots are past Remove far away's distance, for its row: worked out again every quarter second, not every frame. */
  private farCount(present: readonly Robot[], stepped: boolean): number {
    const had = this.farAt;
    const tick = this.world.tick;
    if (had && had.distance === this.farDistance && had.robots === present.length && (!stepped || tick - had.tick < 15)) return had.count;
    const count = farIds(present.map((r) => this.spot(r)), this.farDistance).length;
    this.farAt = { tick, robots: present.length, distance: this.farDistance, count };
    return count;
  }

  private farAt: { tick: number; robots: number; distance: number; count: number } | undefined;

  /** M16, the Sandbox menu: every robot farther than the chosen distance from the middle of the world. */
  removeFar(): number {
    return this.removeRobots(farIds(this.present().map((r) => this.spot(r)), this.farDistance));
  }

  setFarDistance(distance: number): void {
    this.farDistance = distance;
    saveFarDistance(this.settingsStore, distance);
  }

  /** M16, the Sandbox menu: every robot of a team, the pieces that broke off them included. */
  removeTeam(team: number): number {
    return this.removeRobots(teamIds(this.present(), team));
  }

  get isRemoving(): boolean {
    return this.removeArmed;
  }

  /** M16: arms the remove cursor (the bar's Remove button), or disarms it. Arming it puts a held robot away. */
  toggleRemoving(): void {
    if (this.removeArmed) {
      this.stopRemoving();
      return;
    }
    this.cancelPlacing();
    this.removeArmed = true;
  }

  stopRemoving(): void {
    this.removeArmed = false;
    this.hoverId = undefined;
  }

  /** The robot whose body is under a screen point, if any. */
  private robotAt(sx: number, sy: number): Robot | undefined {
    const p = screenToWorld(this.cam, sx, sy, this.renderer.screenWidth, this.renderer.screenHeight);
    const body = this.world.physics.dynamicBodyAt(p.x, p.y);
    if (body === undefined) return undefined;
    return this.world.robots.find((r) => !this.world.removing(r.id) && r.groups.some((g) => g.bodyId === body));
  }

  /** The orange outline of the robot under the remove cursor: every body of it, edge by edge where no cell is beyond. */
  private drawOutline(alpha: number): void {
    const g = this.outline;
    g.clear();
    const robot = this.removeArmed && this.hoverId !== undefined && !this.world.removing(this.hoverId) ? this.world.robotById(this.hoverId) : undefined;
    if (!robot) return;
    let o = this.outlineOf;
    if (!o || o.id !== robot.id || o.version !== robot.version) {
      const cells: { x: number; y: number }[][] = robot.groups.map(() => []);
      for (const part of robot.parts.values()) {
        for (const fc of part.footprint ?? part.def.footprint) {
          const c = rotateCell(fc, part.rot);
          cells[part.group]?.push({ x: part.localX + c.x, y: part.localY + c.y });
        }
      }
      o = { id: robot.id, version: robot.version, bodies: cells.map(outlineEdges) };
      this.outlineOf = o;
    }
    const px = 1 / this.cam.zoom;
    robot.groups.forEach((group, i) => {
      const s = interpolateState(this.world.physics.prevState(group.bodyId), this.world.physics.state(group.bodyId), alpha);
      const c = Math.cos(s.angle);
      const n = Math.sin(s.angle);
      const at = (x: number, y: number) => toScreen({ x: s.x + c * x - n * y, y: s.y + n * x + c * y });
      for (const e of o.bodies[i] ?? []) {
        const a = at(e.x1, e.y1);
        const b = at(e.x2, e.y2);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    });
    // A wide soft band under a thin bright line, a few screen pixels at any zoom.
    g.stroke({ color: 0xe08a2e, width: 7 * px, alpha: 0.35, cap: 'round' });
    g.stroke({ color: 0xffa040, width: 2.5 * px, alpha: 1, cap: 'round' });
  }

  /** Views follow the robots (M16: a rebuilt robot keeps the drawings of the parts it still has, `RobotView.syncAll`). */
  private syncViews(): void {
    const drawing = { frame: (f: string) => this.textures.part(f), animations: (name: string) => this.textures.fx.animations[name] ?? [], registry: this.world.registry };
    RobotView.syncAll(this.views, this.world.robots, drawing, this.renderer.bodies);
  }

  /**
   * Follows the robot and takes control of it when it has a core (`11`). Watching a core-less robot lets go of the
   * one you were controlling (it latches), so your keys never drive a robot you cannot see.
   */
  focus(robotId: number): void {
    this.focusId = robotId;
    this.cam = setFollow(this.cam, true);
    this.keys.setControlled(this.possessable(robotId) ? robotId : undefined);
  }

  /** Only your own robots with a live core (M8): an enemy can be watched, never driven. Nor one waiting to be removed (M16). */
  private possessable(robotId: number): boolean {
    const robot = this.world.robots.find((r) => r.id === robotId);
    return robot !== undefined && !this.world.removing(robotId) && canPossess({ team: robot.team, controllable: this.world.canControl(robotId) });
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

  /** Opens or folds the live readout (M16). Folded, the world is asked for no trace. */
  setReadout(open: boolean): void {
    this.readoutOpen = open;
    this.readoutAt = undefined;
    try {
      this.settingsStore?.setItem(READOUT_KEY, open ? 'open' : 'folded');
    } catch {
      // not kept: nothing else to do
    }
  }

  /**
   * The readout of the followed robot. The trace is asked for only while the readout is open and only for that robot;
   * the text is made again every sixth tick (and at once on a step while paused), so it can be read.
   */
  private readout(focus: Robot | undefined, controlled: boolean, stepped: boolean): ReadoutView | undefined {
    this.world.setTrace(this.readoutOpen && focus ? focus.id : undefined);
    if (!focus) {
      this.readoutAt = undefined;
      return undefined;
    }
    const tick = this.world.tick;
    const had = this.readoutAt;
    const scripts = this.world.scripts(focus.id);
    // Keys held that its running scripts read: a change shows at once, not on the sixth tick.
    const controller = controlled ? this.world.controller(focus.id) : undefined;
    const held = controller ? (key: string): boolean => controller.isHeld(key) || this.keys.isDown(key) : undefined;
    const heldNow = held ? [...new Set(scripts.flatMap((s) => (s.enabled ? (s.reads ?? []) : [])))].filter(held).join(',') : '';
    const due = !had || had.robot !== focus.id || had.open !== this.readoutOpen || had.held !== heldNow || (had.tick !== tick && (tick - had.tick >= 6 || (stepped && this.time.paused)));
    if (had && !due) return had.view;
    const trace = this.readoutOpen ? this.world.trace(focus.id) : undefined;
    const registry = this.world.registry;
    const view = buildReadout({
      robot: focus.name,
      watching: !controlled,
      scripts,
      ...(held ? { held } : {}),
      logs: this.readoutOpen ? this.world.scriptLogs.filter((l) => l.robot === focus.id) : [],
      ...(trace ? { trace } : {}),
      ...(this.costs.cost(focus.id) !== undefined ? { cost: this.costs.cost(focus.id) as number } : {}),
      typeOf: (id) => focus.parts.get(id)?.def.id,
      typeName: (type) => (registry.has(type) ? registry.get(type).name.toLowerCase() : type),
    });
    this.readoutAt = { robot: focus.id, tick, open: this.readoutOpen, held: heldNow, view };
    return view;
  }

  /** The debug overlay's slowest scripts, by robot: "slowest scripts: Anvil 3.1 ms, enemy drone (4) 0.40 ms". */
  private slowestLine(): string {
    const top = this.costs.slowest(3);
    if (top.length === 0) return 'slowest scripts: none running';
    return `slowest scripts: ${top.map((t) => `${this.world.robotById(t.robot)?.name ?? 'gone'} (${t.robot}) ${msText(t.ms)}`).join(', ')}   a tick each`;
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

  /**
   * Shows a ghost of the blueprint on the cursor until a click drops it, or Esc or a right click cancels. Shift+click
   * drops one and keeps it on the cursor for the next.
   */
  startPlacing(raw: unknown, registry: PartRegistry): void {
    this.cancelPlacing();
    this.stopRemoving();
    this.placing = { ghost: this.makeGhost(raw, registry), source: raw, registry, ok: false };
    this.cam = setFollow(this.cam, false);
  }

  /** The ghost of `raw` as the deploy settings orient it; hidden until the cursor is over the world. */
  private makeGhost(raw: unknown, registry: PartRegistry): SpawnGhost {
    const ghost = new SpawnGhost(orientRaw(raw, { flip: this.deploy.flip, rot: this.deploy.rot }, registry), registry, (f) => this.textures.part(f));
    ghost.root.visible = false;
    this.renderer.bodies.addChild(ghost.root);
    return ghost;
  }

  /** Flips the held robot left to right (F while placing). Sticks for later deploys. */
  flipPlacing(): void {
    this.setDeploy(flipped(this.deploy));
  }

  /** Turns the held robot a quarter turn counterclockwise (R while placing). Sticks for later deploys. */
  turnPlacing(): void {
    this.setDeploy(turned(this.deploy));
  }

  /** Straight to one speed of `TIME_SCALES` (the time panel's arrows). */
  setSpeed(index: number): void {
    this.time.setScale(index);
  }

  /** Switches the side the next deploy joins. Sticks. */
  toggleDeployTeam(): void {
    this.setDeploy(nextTeam(this.deploy));
  }

  private setDeploy(next: DeploySettings): void {
    this.deploy = next;
    saveDeploySettings(this.settingsStore, next);
    const p = this.placing;
    if (!p) return;
    const shown = p.ghost.root.visible;
    p.ghost.destroy();
    this.placing = { ...p, ghost: this.makeGhost(p.source, p.registry) };
    if (shown) this.recheckGhost();
  }

  /** Checks the ghost again where it is, without the cursor moving: after a turn, or a drop that keeps placing. */
  private recheckGhost(): void {
    const p = this.placing;
    if (!p?.at) return;
    const check = this.world.canPlace(p.ghost.raw, p.at);
    this.placing = { ...p, ok: check.ok, ...(check.reason !== undefined ? { reason: check.reason } : {}) };
    p.ghost.root.visible = true;
    p.ghost.place(p.at, check.ok);
  }

  cancelPlacing(): void {
    this.placing?.ghost.destroy();
    this.placing = undefined;
  }

  private updateGhost(sx: number, sy: number): void {
    const p = this.placing;
    if (!p) return;
    const at = snapDrop(screenToWorld(this.cam, sx, sy, this.renderer.screenWidth, this.renderer.screenHeight));
    this.placing = { ...p, at };
    this.recheckGhost();
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
        // Not one waiting to be removed (a removal while paused goes on the next tick).
        const next = nextRobot(
          this.present().map((r) => ({ id: r.id, controllable: this.possessable(r.id) })),
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
    // The frame is not drawn while the builder is open, so the sound hears of the pause here.
    this.sound.setPaused(paused);
    if (paused) this.stepper.reset();
    else this.stepper.resume();
  }

  onWheel(e: WheelEvent): void {
    this.cam = zoomBy(this.cam, Math.exp(-e.deltaY * 0.0015));
  }

  onPointerDown(e: PointerEvent, sx: number, sy: number): void {
    // M16: a right click puts the remove cursor away.
    if (this.removeArmed && e.button === 2) {
      this.stopRemoving();
      return;
    }
    if (this.placing) {
      if (e.button === 0) this.updateGhost(sx, sy);
      const p = this.placing;
      const press = placePress(e.button, e.shiftKey, p.ok && p.at !== undefined);
      if (press === 'stop') {
        this.cancelPlacing();
        return;
      }
      if ((press === 'drop' || press === 'drop-and-keep') && p.at) {
        if (press === 'drop') this.cancelPlacing();
        this.spawn(p.ghost.raw, p.at, this.deploy.team);
        if (press === 'drop-and-keep') {
          // Still placing: the camera stays where it is, so the next drop lands where the cursor points. The ghost
          // turns red now, on top of the robot just dropped.
          this.cam = setFollow(this.cam, false);
          this.recheckGhost();
        }
      }
      if (press !== 'pass') return;
    }
    this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
  }

  onPointerMove(e: PointerEvent, sx: number, sy: number): void {
    this.pointer = { sx, sy };
    if (this.placing) this.updateGhost(sx, sy);
    if (this.removeArmed) this.hoverId = this.robotAt(sx, sy)?.id;
    if (!this.dragging || e.pointerId !== this.dragging.id) return;
    this.cam = panByPixels(this.cam, e.clientX - this.dragging.x, e.clientY - this.dragging.y);
    this.dragging = { ...this.dragging, x: e.clientX, y: e.clientY };
  }

  /** The pointer left the world's canvas: the remove cursor points at nothing. */
  onPointerLeave(): void {
    this.pointer = undefined;
    this.hoverId = undefined;
  }

  /** A click (not a drag) on a robot takes control of it, or with the remove cursor armed removes it (M16). */
  onPointerUp(e: PointerEvent, sx: number, sy: number): void {
    const d = this.dragging;
    if (!d || e.pointerId !== d.id) return;
    this.dragging = null;
    if (e.button !== 0 || !isClick({ x: d.startX, y: d.startY }, { x: e.clientX, y: e.clientY })) return;
    const robot = this.robotAt(sx, sy);
    if (robot && this.removeArmed) {
      // It stays armed for the next one.
      this.removeRobots([robot.id]);
      this.hoverId = undefined;
      return;
    }
    if (robot) {
      // A click drags the camera by a pixel or two; undo that so the robot does not jump.
      this.cam = panByPixels(this.cam, d.startX - e.clientX, d.startY - e.clientY);
      this.focus(robot.id);
    }
  }

  /** Whether a world point is on screen (with a little margin). */
  private onScreen(x: number, y: number): boolean {
    const half = (px: number): number => (px / 2 / (this.cam.zoom * PIXELS_PER_METER)) * 1.2;
    return Math.abs(x - this.cam.x) < half(this.renderer.screenWidth) && Math.abs(y - this.cam.y) < half(this.renderer.screenHeight);
  }

  /** What every robot's sensors see and its scripts marked, for the debug overlay (M8). */
  private sensorOverlays(): SensorOverlay[] {
    const out: SensorOverlay[] = [];
    for (const r of this.world.robots) {
      const view = this.world.sensorView(r.id);
      const marks = this.world.marks(r.id);
      const sights = [];
      for (const part of r.parts.values()) {
        if ((part.def.gun === undefined && part.def.laser === undefined && part.def.cannon === undefined) || !part.sight) continue;
        const aim = part.sight.aim;
        // M15: a charged gun's sight starts at the world's own barrel end (a cannon's is between its two cells).
        const end = part.def.cannon !== undefined ? this.world.barrelEnd(r.id, part.id) : undefined;
        if (end) {
          sights.push({ x: end.x, y: end.y, aim, distance: part.sight.distance, side: part.sight.side });
          continue;
        }
        const pose = partWorldPose(this.world, r, part.id);
        // From the barrel's end: half a cell past the base for a gun, a cell and a half for a laser (M14, 1 by 2). Both
        // are straight parts along their aim; a bent multi-cell sight part would need the world's own muzzle.
        const reach = (part.footprint ?? part.def.footprint).length - 0.5;
        sights.push({ x: pose.x + reach * Math.cos(aim), y: pose.y + reach * Math.sin(aim), aim, distance: part.sight.distance, side: part.sight.side });
      }
      if (view.sensors.length === 0 && marks.length === 0 && sights.length === 0) continue;
      const s = sampleRobot(this.world, r);
      out.push({ ...view, from: { x: s.coreX, y: s.coreY }, marks, sights });
    }
    return out;
  }

  frame(ticker: Ticker): void {
    const time = this.time;
    let ticks = time.takePendingSteps();
    if (time.paused) this.stepper.reset();
    else ticks += this.stepper.advance(ticker.deltaMS, time.timeScale);
    let simMs = 0;
    // At most SIM_BUDGET_MS of sim per frame: a scene too heavy for the speed asked runs slower instead of dragging
    // the frame rate down (Gate 10: 4x in a big battle fell to 10 fps).
    const ran = runWithin(ticks, SIM_BUDGET_MS, () => performance.now(), (i) => {
      // Keys are sampled once per tick: this frame's edges go into its first tick. While paused they wait.
      const t = performance.now();
      this.world.step(i === 0 ? this.keys.drain() : []);
      simMs += performance.now() - t;
      this.afterStep?.();
      if (this.world.tick % 60 === 0) {
        this.lastHash = this.world.hash();
        this.costs.keep(this.world.robots.filter((r) => this.world.scripts(r.id).some((sc) => sc.enabled)).map((r) => r.id));
      }
    });
    // Ticks it had no room for are dropped: the stepper already counted their time as spent.
    ticks = ran;
    const viewStart = performance.now();
    const scripts = this.clock?.take() ?? { ms: 0, calls: 0 };

    if (ticks > 0) this.syncViews();
    // A robot whose core was destroyed cannot be driven any more: let go of it (the world would drop the keys anyway).
    if (this.keys.robot !== undefined && !this.world.canControl(this.keys.robot)) this.keys.setControlled(undefined);
    const alpha = time.paused ? 1 : this.stepper.alpha;
    for (const [id, v] of this.views) {
      if (this.world.removing(id)) {
        v.root.visible = false;
        continue;
      }
      // A part that needs energy only looks busy (flame, spinning blades) while its robot has some to give.
      const powered = this.world.unlimitedEnergy || (this.world.energy(id)?.stored ?? 0) > 0;
      const robot = this.world.robotById(id);
      v.sync(this.world.physics, alpha, (partId, channel) =>
        !powered && (robot?.parts.get(partId)?.def.powerDraw ?? 0) > 0 ? 0 : this.world.channelValue(id, partId, channel),
      );
    }
    const simDt = time.paused ? 0 : (ticker.deltaMS / 1000) * time.timeScale;
    this.effects.update(simDt);
    this.shells.draw([...this.world.liveShells(), ...this.world.spentShells()], alpha);
    this.beams.draw(this.world, alpha, simDt, this.cam.zoom);
    this.bolts.draw(this.world, alpha, simDt, this.cam.zoom);
    this.smoke.draw(this.world.smokeClouds());
    this.ropes.draw(this.world.liveRopes());
    const focus = this.world.robots.find((r) => r.id === this.focusId);
    if (focus) this.cam = followTarget(this.cam, anchorPosition(this.world, focus, alpha), ticker.deltaMS / 1000);
    applyCamera(this.renderer.world, this.cam, this.renderer.screenWidth, this.renderer.screenHeight);
    // The robot under the remove cursor, found again now the robots and the camera have moved: the outline is always
    // the robot a click takes (a click finds it the same way, with this camera).
    if (this.removeArmed) this.hoverId = this.pointer ? this.robotAt(this.pointer.sx, this.pointer.sy)?.id : undefined;
    this.drawOutline(alpha);
    if (this.shake > 0.3) {
      this.renderer.world.position.x += (Math.random() - 0.5) * 2 * this.shake;
      this.renderer.world.position.y += (Math.random() - 0.5) * 2 * this.shake;
      this.shake *= Math.exp(-(ticker.deltaMS / 1000) * 7);
    } else this.shake = 0;
    if (this.debugVisible) {
      drawDebug(this.renderer.debug, this.world.physics.debugRender(), true);
      drawSensors(this.renderer.debug, this.sensorOverlays());
    } else this.renderer.debug.clear();

    const s = focus ? sampleRobot(this.world, focus) : undefined;
    // Robots waiting to be removed (a removal while paused goes on the next tick) are not counted.
    const present = this.present();
    const controlled = this.keys.robot === undefined ? undefined : this.world.robots.find((r) => r.id === this.keys.robot);
    const robotLine =
      focus && s
        ? `${focus.id === controlled?.id ? 'controlling' : focus.team !== 0 ? `watching ${teamName(focus.team).toLowerCase()}` : 'watching'} ${focus.name} (${present.indexOf(focus) + 1}/${present.length})   ${s.speed.toFixed(1)} m/s   core (${s.coreX.toFixed(2)}, ${s.coreY.toFixed(2)})   tilt ${s.tiltDeg.toFixed(1)}   ${s.resting ? 'resting' : 'moving'}   ${s.massKg.toFixed(1)} kg`
        : present.length > 0
          ? 'following no robot: click one, or press , for the next'
          : 'no robots yet: build one and press Test';
    // M16: who the camera is on, for the time panel at the top left.
    const who =
      focus !== undefined
        ? `${focus.id === controlled?.id ? 'controlling' : focus.team !== 0 ? `watching ${teamName(focus.team).toLowerCase()}` : 'watching'} ${focus.name}`
        : present.length > 0
          ? 'following no robot: click one'
          : 'no robots yet';
    const p = this.placing;
    const hovered = this.removeArmed && this.hoverId !== undefined ? this.world.robotById(this.hoverId) : undefined;
    const placingLines = p
      ? [placingLine({ name: p.ghost.name, team: this.deploy.team, flip: this.deploy.flip, rot: this.deploy.rot, ok: p.ok, ...(p.reason !== undefined ? { reason: p.reason } : {}) })]
      : this.removeArmed
        ? [`REMOVING: click a robot to take it out of the world   Esc or right click stops   ${hovered ? `${hovered.name} (${teamName(hovered.team)}${hovered.brokeFrom !== undefined ? ', a piece' : ''})` : 'point at a robot'}`]
        : [];
    const view: WorldView = {
      paused: time.paused,
      timeScale: time.timeScale,
      who,
      debug: this.debugVisible,
      grid: this.grid.visible,
      follow: this.cam.follow,
      robots: present.length,
      deployTeam: this.deploy.team,
      sound: { ...this.sound.settings, awake: this.sound.awake },
      unlimitedEnergy: this.world.unlimitedEnergy,
      removing: this.removeArmed,
      teams: teamCounts(present),
      far: { distance: this.farDistance, count: this.farCount(present, ticks > 0) },
      readoutOpen: this.readoutOpen,
    };
    const readout = this.readout(focus, focus !== undefined && focus.id === controlled?.id, ticks > 0);
    if (readout) view.readout = readout;
    for (; this.eventCursor < this.world.events.length; this.eventCursor++) {
      const ev = this.world.events[this.eventCursor];
      const who = this.world.robots.find((r) => r.id === ev?.robot);
      if (ev) this.sound.event(ev, this.world);
      if (ev?.kind === 'energyEmpty' && who) this.onNotice?.(`${who.name} ran out of energy`);
      if (ev?.kind === 'scriptCrashed' && who) this.onNotice?.(`${who.name}: script "${ev.script}" stopped. ${ev.error.message}`);
      if (ev?.kind === 'explosion') this.effects.explosion(ev.x, ev.y, ev.radius);
      if (ev?.kind === 'decoupled') this.effects.spark(ev.x, ev.y);
      if (ev?.kind === 'shellHit') this.effects.hit(ev.x, ev.y);
      // M15: charged guns. A ring of light at the barrel on firing (and a jolt of the camera for the cannon), a
      // blue-white burst where a bolt takes a part, a grey-blue puff on a backfire.
      if (ev?.kind === 'cannonFire' || ev?.kind === 'cannonBackfire') {
        const spec = this.world.registry.has(ev.partType) ? this.world.registry.get(ev.partType).cannon : undefined;
        const big = (spec?.width ?? 0) > 0;
        if (ev.kind === 'cannonBackfire') this.effects.backfire(ev.x, ev.y, big ? 1.6 : 1);
        else {
          this.effects.boltFlash(ev.x, ev.y, big ? 2.2 : 1);
          if (big && this.onScreen(ev.x, ev.y)) this.shake = Math.max(this.shake, 9);
        }
      }
      if (ev?.kind === 'boltHit') this.effects.boltHit(ev.x, ev.y, ev.damage);
      // A part that explodes gets the blast instead of a puff (an unarmed warhead just breaks: M10).
      // A burnt-out flare (M11) just goes out.
      if (ev?.kind === 'partDestroyed' && !ev.exploded && ev.burntOut !== true) this.effects.breakPuff(ev.x, ev.y);
      // M14: a laser blowing up gets its own look on top of the blast, and shakes the camera when it is on screen.
      if (ev?.kind === 'partDestroyed' && ev.exploded && this.world.registry.has(ev.partType)) {
        const def = this.world.registry.get(ev.partType);
        if (def.laser !== undefined) {
          this.effects.laserBlast(ev.x, ev.y, def.onDestroyed?.explode?.radius ?? 2);
          if (this.onScreen(ev.x, ev.y)) this.shake = Math.max(this.shake, 16);
        }
        // M15: a charged gun going up is the same blast in light blue.
        if (def.cannon !== undefined) {
          this.effects.laserBlast(ev.x, ev.y, def.onDestroyed?.explode?.radius ?? 2, 0x4fc8ff, 0xc8f0ff);
          if (this.onScreen(ev.x, ev.y)) this.shake = Math.max(this.shake, 16);
        }
      }
      if (ev?.kind === 'coreLost' && who) this.onNotice?.(`${who.name} lost its core: nobody controls it now, and it keeps doing what it was doing`);
      // Only your own: an enemy's missiles wake too, and you cannot take them over.
      if (ev?.kind === 'coreWoke' && who && who.team === 0) this.onNotice?.(`A core woke up in a piece that broke off ${who.name}: click it to control it`);
    }
    this.sound.frame(this.world, this.cam, this.renderer.screenWidth, time);
    const controller = controlled ? this.world.controller(controlled.id) : undefined;
    if (controlled && controller) {
      // A key bound to a script is a toggle too, lit while any of its scripts runs.
      const scripts = this.world.scripts(controlled.id);
      const scriptKeys = new Map<string, string[]>();
      // A core that woke in a broken-off piece runs its own controls (M7), not its blueprint's top-level ones.
      for (const b of activeControls(controlled).bindings) if (b.mode === 'script' && b.script !== undefined) scriptKeys.set(b.key, [...(scriptKeys.get(b.key) ?? []), b.script]);
      const toggles = new Set([...controller.toggleKeys, ...scriptKeys.keys()]);
      const scriptOn = (key: string): boolean => (scriptKeys.get(key) ?? []).some((id) => scripts.find((s) => s.id === id)?.enabled === true);
      // Auto control keys first (Q W E A S D), then custom keys in binding order.
      const rank = (k: string): number => (AUTO_KEYS.includes(k) ? AUTO_KEYS.indexOf(k) : AUTO_KEYS.length);
      const keys = controller.keys.map((key, i) => ({ key, i })).sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i);
      // Keys the running scripts read themselves (a hover's W and S): shown after the bound keys, marked as script keys.
      const running = activeControls(controlled).scripts.filter((sc) => scripts.some((r) => r.id === sc.id && r.enabled && !r.crashed));
      const read = [...this.scriptKeysOf(running)].filter((k) => !controller.keys.includes(k)).sort((a, b) => rank(a) - rank(b));
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
        scriptKeys: read.map((key) => ({ key, held: this.keys.isDown(key) })),
      };
    }
    const key = JSON.stringify(view);
    if (key !== this.lastView) {
      this.lastView = key;
      this.onView?.(view);
    }
    if (this.debugVisible) {
      this.hud.set(
        [
          `tick ${this.world.tick}   t=${this.world.time.toFixed(2)}s   ${Math.round(ticker.FPS)} fps`,
          `${time.paused ? 'PAUSED' : 'running'}   x${time.timeScale}   zoom ${this.cam.zoom.toFixed(2)}   follow ${this.cam.follow ? 'on' : 'off'}`,
          robotLine,
          ...placingLines,
          ...this.perf.lines(this.world.robots.length),
          this.slowestLine(),
          this.sound.debugLine(),
          `hash ${this.lastHash}`,
          HELP,
        ],
        true,
      );
    } else {
      // M16: the clock, the speed and who you control or watch are in the time panel; the raw text is behind Debug.
      this.hud.set(placingLines);
    }
    const clock = clockText(this.world.time);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.onClock?.(clock);
    }
    this.perf.add({ frameMs: ticker.deltaMS, ticks, simMs, scriptMs: scripts.ms, scriptCalls: scripts.calls, viewMs: performance.now() - viewStart });
  }
}

/** The browser's local storage, or undefined where it is blocked (a private window, a test without a DOM). */
function browserStorage(): SettingsStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
