import type { Issue, PartDef } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import { BlueprintPicker } from './BlueprintPicker';

export interface BuilderActions {
  hold(part: string): void;
  /** Holds a copy of a saved blueprint to place (M7). */
  holdBlueprint(file: string): void;
  /** Which core the Controls and Scripts panels edit; undefined is the main core. */
  setControlsFor(core: string | undefined): void;
  eraser(): void;
  open(file: string): void;
  newBlank(): void;
  save(): void;
  saveAs(): void;
  remove(): void;
  deploy(): void;
  focusIssue(issue: Issue): void;
}

export function TopBar({ store, actions }: { store: Store<AppState>; actions: BuilderActions }) {
  const doc = useStore(store, (s) => s.doc);
  return (
    <div class="topbar panel">
      <label class="field">
        <span>Blueprint</span>
        <BlueprintPicker files={doc.files} current={doc.file} label={doc.files.find((f) => f.file === doc.file)?.name ?? doc.name} onOpen={(f) => actions.open(f)} />
      </label>
      <button onClick={actions.newBlank}>New</button>
      <button onClick={actions.save} aria-keyshortcuts="Meta+S">
        Save
      </button>
      <button onClick={actions.saveAs}>Save As</button>
      <button onClick={actions.remove} disabled={doc.file === undefined}>
        Delete
      </button>
      <span class="doc-name">
        {doc.name}
        {doc.dirty && <span class="dirty" title="unsaved changes" />}
      </span>
      <span class="spacer" />
      <button class="primary deploy" onClick={actions.deploy}>
        Deploy
      </button>
    </div>
  );
}

/** The builder key for each palette slot, in order (`Builder.ts` handles them). */
const PALETTE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ';', "'", '/'];

export function Palette({ store, defs, actions }: { store: Store<AppState>; defs: PartDef[]; actions: BuilderActions }) {
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const icons = useStore(store, (s) => s.icons);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const doc = useStore(store, (s) => s.doc);
  // Every saved blueprint except the one open (placing a robot on itself would be a copy of a copy).
  const saved = doc.files.filter((f) => f.file !== doc.file);
  return (
    <div class="palette panel">
      {defs.map((d, i) => {
        const key = PALETTE_KEYS[i];
        return (
          <button key={d.id} class={held?.part === d.id ? 'part active' : 'part'} onClick={() => actions.hold(d.id)} title={key ? `${d.name} (${key})` : d.name}>
            {icons[d.id] ? <img src={icons[d.id]} alt="" /> : <span class="icon-missing" />}
            <span class="part-name">{d.name}</span>
            {key && <span class="part-key">{key}</span>}
          </button>
        );
      })}
      <button class={eraser ? 'part eraser active' : 'part eraser'} onClick={actions.eraser} title="Eraser (E): click or drag to erase">
        <span class="eraser-icon" />
        <span class="part-name">Eraser</span>
        <span class="part-key">E</span>
      </button>
      {saved.length > 0 && <h4 title="place a copy of a saved blueprint: R turns it, F flips it, click places it">Blueprints</h4>}
      {saved.map((f) => (
        <button key={f.file} class={stamp?.name === f.name ? 'blueprint active' : 'blueprint'} title={`place a copy of ${f.name} (R turns, F flips, Esc drops)`} onClick={() => actions.holdBlueprint(f.file)}>
          {f.name}
        </button>
      ))}
    </div>
  );
}

/** Shown in the Controls and Scripts panels when the robot has more than one core (M7): whose controls you edit. */
export function ControlsFor({ store, actions }: { store: Store<AppState>; actions: Pick<BuilderActions, 'setControlsFor'> }) {
  const cores = useStore(store, (s) => s.builder.cores);
  const current = useStore(store, (s) => s.builder.controlsFor);
  if (cores.length < 2) return null;
  return (
    <label class="controls-for small" title="a placed blueprint's core runs its own controls when its piece breaks off">
      <span>Controls for</span>
      <select value={current ?? ''} onChange={(e) => actions.setControlsFor((e.target as HTMLSelectElement).value || undefined)}>
        {cores.map((c) => (
          <option key={c.core ?? ''} value={c.core ?? ''}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IssuesPanel({ store, actions }: { store: Store<AppState>; actions: BuilderActions }) {
  const issues = useStore(store, (s) => s.builder.issues);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section class="side-section">
      <h3>
        Issues {issues.length > 0 && <span class={errors > 0 ? 'count error' : 'count warning'}>{issues.length}</span>}
      </h3>
      {issues.length === 0 ? (
        <p class="muted">No issues. Ready to deploy.</p>
      ) : (
        <ul class="issues">
          {issues.map((i, n) => (
            <li key={n} class={i.severity} onClick={() => actions.focusIssue(i)}>
              <span class="code">{i.code}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StatsBadge({ store }: { store: Store<AppState> }) {
  const stats = useStore(store, (s) => s.builder.stats);
  const mirror = useStore(store, (s) => s.builder.mirror);
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const stamp = useStore(store, (s) => s.builder.stamp);
  const refused = useStore(store, (s) => s.builder.refused);
  return (
    <div class="stats panel">
      <span>{stats.parts} parts</span>
      <span>{stats.massKg.toFixed(1)} kg</span>
      {stats.massKg > 0 && (
        <span title="center of mass, in cells">
          balance ({stats.comX.toFixed(2)}, {stats.comY.toFixed(2)})
        </span>
      )}
      {stats.parts > 0 && (
        <span title="energy held by cores and batteries; how long it lasts with every part working at full power">
          energy {stats.energy}
          {stats.fullDraw > 0 ? ` · full draw ${stats.fullDraw}/s (${formatDuration(stats.energy / stats.fullDraw)})` : ''}
        </span>
      )}
      <span class={mirror.on ? 'on' : 'muted'}>mirror {mirror.on ? `on at x ${(mirror.axisHalfCells / 2).toFixed(1)}` : 'off'}</span>
      {held && <span>holding {held.part} {held.rot}°</span>}
      {stamp && (
        <span class="on">
          placing {stamp.name} {stamp.rot}°{stamp.flipped ? ' flipped' : ''}
        </span>
      )}
      {stamp && refused && <span class="refused">{refused}</span>}
      {eraser && <span class="on">eraser</span>}
    </div>
  );
}

export function BuilderHelp() {
  return (
    <div class="help">
      1-9, 0, - pick part · click or drag to paint · Blueprints: click to hold a copy, R turn, F flip · E eraser · right-click a part for its menu · R rotate · Esc drop · M mirror ([ ] move axis) ·
      Space+drag or middle-drag pan · wheel zoom · Cmd+Z undo · Tab world
    </div>
  );
}

/** 42 s, 3 min 30 s. */
function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}
