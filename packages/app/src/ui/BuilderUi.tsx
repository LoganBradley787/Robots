import type { Issue, PartDef } from '@robots/sim-core';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';

export interface BuilderActions {
  hold(part: string): void;
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
        <select
          value={doc.file ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v !== '') actions.open(v);
            (e.target as HTMLSelectElement).value = doc.file ?? '';
          }}
        >
          {doc.file === undefined && <option value="">(not saved yet)</option>}
          {doc.files.map((f) => (
            <option key={f.file} value={f.file}>
              {f.name}
            </option>
          ))}
        </select>
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

export function Palette({ store, defs, actions }: { store: Store<AppState>; defs: PartDef[]; actions: BuilderActions }) {
  const held = useStore(store, (s) => s.builder.held);
  const eraser = useStore(store, (s) => s.builder.eraser);
  const icons = useStore(store, (s) => s.icons);
  return (
    <div class="palette panel">
      {defs.map((d, i) => (
        <button key={d.id} class={held?.part === d.id ? 'part active' : 'part'} onClick={() => actions.hold(d.id)} title={`${d.name} (${i + 1})`}>
          {icons[d.id] ? <img src={icons[d.id]} alt="" /> : <span class="icon-missing" />}
          <span class="part-name">{d.name}</span>
          <span class="part-key">{i + 1}</span>
        </button>
      ))}
      <button class={eraser ? 'part eraser active' : 'part eraser'} onClick={actions.eraser} title="Eraser (E): click or drag to erase">
        <span class="eraser-icon" />
        <span class="part-name">Eraser</span>
        <span class="part-key">E</span>
      </button>
    </div>
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
  return (
    <div class="stats panel">
      <span>{stats.parts} parts</span>
      <span>{stats.massKg.toFixed(1)} kg</span>
      {stats.massKg > 0 && (
        <span title="center of mass, in cells">
          balance ({stats.comX.toFixed(2)}, {stats.comY.toFixed(2)})
        </span>
      )}
      <span class={mirror.on ? 'on' : 'muted'}>mirror {mirror.on ? `on at x ${(mirror.axisHalfCells / 2).toFixed(1)}` : 'off'}</span>
      {held && <span>holding {held.part} {held.rot}°</span>}
      {eraser && <span class="on">eraser</span>}
    </div>
  );
}

export function BuilderHelp() {
  return (
    <div class="help">
      1-9 pick part · click or drag to paint · E eraser · right-click a part for its menu · R rotate · Esc drop · M mirror ([ ] move axis) ·
      Space+drag or middle-drag pan · wheel zoom · Cmd+Z undo · Tab world
    </div>
  );
}
