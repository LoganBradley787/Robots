import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { defaultSize, footprintOf, partCells, partMass, type Blueprint, type PartDef, type PartRegistry, type PlacedPart } from '@robots/sim-core';
import { autoLabel } from '../builder/bindings';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState, InspectorTab } from './appState';
import type { AppActions } from './App';
import type { PartActions } from './actions';
import { BindingsPanel } from './BindingsPanel';
import { ScriptsPanel } from './ScriptsPanel';
import { Problems } from './Problems';
import { PartNumbers } from './Drawer';
import { Button, Check, Select, Sprite, Tabs, type SelectOption, type TabSpec } from './kit';
import { formatDuration, num } from './format';

/**
 * The inspector (M16), at the right. Part: what is selected, built from its definition (it took over everything the
 * floating part menu did). Robot: the whole machine's numbers. Keys and Behaviors: its controls and scripts.
 * Problems stays pinned under every tab.
 */
export function Inspector({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: AppActions }) {
  const want = useStore(store, (s) => s.panel.tab);
  const selected = useStore(store, (s) => s.builder.selection.length);
  const focus = useStore(store, (s) => s.builder.partFocus);
  // Selecting something, or right-clicking a part, turns to the Part tab. After that the tabs are the player's.
  const some = selected > 0;
  const seen = useRef({ some, focus });
  useEffect(() => {
    const was = seen.current;
    seen.current = { some, focus };
    if ((some && !was.some) || (some && focus !== was.focus)) actions.showTab('part');
  }, [some, focus]);
  const tabs: TabSpec<InspectorTab>[] = [
    ...(some ? [{ id: 'part' as const, label: selected === 1 ? 'Part' : `${selected} parts` }] : []),
    { id: 'robot', label: 'Robot' },
    { id: 'keys', label: 'Keys' },
    { id: 'behaviors', label: 'Behaviors' },
  ];
  const tab = tabs.some((t) => t.id === want) ? want : 'robot';
  return (
    <div class="insp plate" onContextMenu={(e) => e.preventDefault()}>
      <Tabs tabs={tabs} value={tab} onChange={actions.showTab} />
      <div class="scroll">
        {tab === 'part' && <PartTab store={store} registry={registry} actions={actions} />}
        {tab === 'robot' && (
          <RobotTab
            store={store}
            registry={registry}
            select={(ids) => {
              // Selecting from here is asking to see them.
              actions.select(ids);
              actions.showTab('part');
            }}
          />
        )}
        {tab === 'keys' && <BindingsPanel store={store} registry={registry} actions={actions} />}
        {tab === 'behaviors' && <ScriptsPanel store={store} actions={actions} />}
      </div>
      <Problems store={store} actions={actions} />
    </div>
  );
}

/** Every group (explicit tag) on the robot with how many parts carry it, by name. A part's own id is not a group. */
function groupsOf(bp: Blueprint): Array<{ tag: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const p of bp.parts) for (const t of p.tags) if (t !== p.id) groups.set(t, [...(groups.get(t) ?? []), p.id]);
  return [...groups].map(([tag, ids]) => ({ tag, ids })).sort((a, b) => a.tag.localeCompare(b.tag));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function PartTab({ store, registry, actions }: { store: Store<AppState>; registry: PartRegistry; actions: PartActions }) {
  const draft = useStore(store, (s) => s.builder.draft);
  const selection = useStore(store, (s) => s.builder.selection);
  const icons = useStore(store, (s) => s.icons);
  const files = useStore(store, (s) => s.doc.files);
  const docFile = useStore(store, (s) => s.doc.file);
  const parts = draft.parts.filter((p) => selection.includes(p.id));
  if (parts.length === 0) return null;
  const ids = parts.map((p) => p.id);
  const defOf = (p: PlacedPart): PartDef | undefined => (registry.has(p.part) ? registry.get(p.part) : undefined);
  const massOf = (p: PlacedPart): number => {
    const d = defOf(p);
    return d ? partMass(d, footprintOf(d, p.size)) : 0;
  };
  const one = parts.length === 1 ? parts[0] : undefined;
  const def = one ? defOf(one) : undefined;

  // The options a definition has: each shows only when a selected part has it, and edits every part that does.
  const autoParts = parts.filter((p) => autoLabel(registry, p) !== undefined);
  const autoOn = autoParts.filter((p) => p.auto !== false).length;
  const armParts = parts.filter((p) => defOf(p)?.arming === true);
  const armedOn = armParts.filter((p) => p.armed === true).length;
  const makers = parts.filter((p) => defOf(p)?.fabricate !== undefined);
  const makes = new Set(makers.map((p) => p.makes ?? ''));
  const making = makes.size === 1 ? [...makes][0] : undefined;
  const stretchy = parts.filter((p) => defOf(p)?.stretch !== undefined);
  const first = stretchy[0];
  const firstDef = first ? defOf(first) : undefined;
  const size: [number, number] = first && firstDef ? (first.size ?? defaultSize(firstDef) ?? [1, 1]) : [1, 1];
  const mixedSize = stretchy.some((p) => JSON.stringify(p.size) !== JSON.stringify(first?.size));
  const resize = (dw: number, dh: number): void => actions.resize(stretchy.map((p) => p.id), dw, dh);
  const anyOption = autoParts.length > 0 || armParts.length > 0 || stretchy.length > 0 || makers.length > 0;
  const makeOptions: SelectOption[] = [
    { value: '', label: 'nothing' },
    ...(draft.recipes ?? []).map((r) => ({ value: `recipe:${r.name}`, label: r.name, group: 'In this robot' })),
    ...files.filter((f) => f.file !== docFile).map((f) => ({ value: `file:${f.file}`, label: f.name, group: 'A copy of a saved robot' })),
  ];

  // Several parts: what they are, by kind.
  const byKind = new Map<string, { name: string; count: number }>();
  for (const p of parts) {
    const e = byKind.get(p.part) ?? { name: defOf(p)?.name ?? p.part, count: 0 };
    e.count++;
    byKind.set(p.part, e);
  }

  return (
    <>
      <div class="sec">
        {one ? (
          <>
            <div class="phead">
              <Sprite src={icons[one.part]} size={52} rot={one.rot} />
              <div>
                <div class="t h">{def?.name ?? one.part}</div>
                {def?.about !== undefined && <div class="about">{def.about}</div>}
                {!def && <div class="about bad-text">No part is called "{one.part}".</div>}
              </div>
            </div>
            <div style={{ marginTop: '8px' }}>
              {def && <PartNumbers def={def} mass={massOf(one)} />}
              <div class="kv" title="its cell on the board, and how far it is turned (counterclockwise)">
                <span>Cell, turn</span>
                <b>
                  {one.x}, {one.y}, {one.rot}&deg;
                </b>
              </div>
              <div class="kv" title="what a key or a script calls this one part">
                <span>Its own name</span>
                <b>{one.id}</b>
              </div>
            </div>
          </>
        ) : (
          <>
            <div class="phead">
              <div class="t h">{parts.length} parts</div>
            </div>
            <div style={{ marginTop: '8px' }}>
              {[...byKind].map(([type, k]) => (
                <div class="kv" key={type}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sprite src={icons[type]} size={18} />
                    {k.name}
                  </span>
                  <b>{k.count}</b>
                </div>
              ))}
              <div class="kv">
                <span>Mass together</span>
                <b>{num(parts.reduce((m, p) => m + massOf(p), 0))} kg</b>
              </div>
            </div>
          </>
        )}
      </div>

      {one && def && (
        <div class="sec">
          <div class="h">
            Inputs <span>what a key or a script can drive</span>
          </div>
          {def.inputs.length === 0 && <p class="dim">Nothing to control on this part.</p>}
          {def.inputs.map((c) => {
            const auto = def.autoControl?.channel === c.name && one.auto !== false && draft.autoControls !== false ? autoLabel(registry, one) : undefined;
            return (
              <div class="irow" key={c.name}>
                <div>
                  <div class="nm">{c.name}</div>
                  <div class="rg">
                    {num(c.min)} to {num(c.max)}
                    {c.default !== 0 ? `, rests at ${num(c.default)}` : ''}
                  </div>
                </div>
                {auto !== undefined && <div class="more">auto: {auto}</div>}
              </div>
            );
          })}
        </div>
      )}

      {one && def && def.outputs.length > 0 && (
        <div class="sec">
          <div class="h">
            Reports <span>what a script can read</span>
          </div>
          {def.outputs.map((c) => (
            <div class="kv" key={c.name}>
              <span class="mono">{c.name}</span>
              <b class="dim">
                {num(c.min)} to {num(c.max)}
              </b>
            </div>
          ))}
        </div>
      )}

      <Groups draft={draft} ids={ids} actions={actions} />

      <div class="sec">
        <div class="h">{anyOption ? 'Settings' : 'Do'}</div>
        {autoParts.length > 0 && (
          <Check checked={autoOn === autoParts.length ? true : autoOn === 0 ? false : 'mixed'} onChange={(on) => actions.setAuto(autoParts.map((p) => p.id), on)}>
            Auto keys <span class="dim">{autoParts.length === 1 && autoParts[0] ? autoLabel(registry, autoParts[0]) : `on for ${autoOn} of ${autoParts.length}`}</span>
          </Check>
        )}
        {autoParts.length > 0 && draft.autoControls === false && <p class="dim small">Auto keys are off for this whole robot (Keys tab).</p>}
        {armParts.length > 0 && (
          <Check
            checked={armedOn === armParts.length ? true : armedOn === 0 ? false : 'mixed'}
            onChange={(on) => actions.setArmed(armParts.map((p) => p.id), on)}
            title="Until it is armed it is a plain part: it breaks without a blast and ignores its trigger. A key or a script arms it (its arm input), for good."
          >
            Armed at start <span class="dim">{armParts.length === 1 ? (armedOn === 1 ? 'live from the start' : 'safe until armed') : `${armedOn} of ${armParts.length}`}</span>
          </Check>
        )}
        {stretchy.length > 0 && (
          <div title="The size of its hollow: what it builds must fit inside. Parts in the way show up in Problems.">
            <div class="stepper">
              <span>Hollow</span>
              <Button small icon onClick={() => resize(-1, 0)} label="narrower">
                -
              </Button>
              <span class="v">{mixedSize ? 'mixed' : `${size[0]} wide`}</span>
              <Button small icon onClick={() => resize(1, 0)} label="wider">
                +
              </Button>
            </div>
            <div class="stepper">
              <span />
              <Button small icon onClick={() => resize(0, -1)} label="shorter">
                -
              </Button>
              <span class="v">{mixedSize ? 'mixed' : `${size[1]} tall`}</span>
              <Button small icon onClick={() => resize(0, 1)} label="taller">
                +
              </Button>
            </div>
          </div>
        )}
        {makers.length > 0 && (
          <div class="opt" title="What it builds: a copy of a robot, out of this robot's energy, held until its release input lets it go. It must fit the hollow (Problems says if not).">
            <span>Makes</span>
            <Select
              value={making === undefined ? undefined : making === '' ? '' : `recipe:${making}`}
              options={makeOptions}
              placeholder="(several)"
              label="what it makes"
              onChange={(v) => {
                const to = makers.map((p) => p.id);
                if (v === '') actions.setMakes(to, undefined);
                else if (v.startsWith('recipe:')) actions.setMakes(to, { recipe: v.slice(7) });
                else if (v.startsWith('file:')) actions.setMakes(to, { file: v.slice(5) });
              }}
            />
          </div>
        )}
        <div class="acts">
          <Button onClick={() => actions.rotate(1)} title="Turn a quarter counterclockwise (R)">
            Turn &#8634;
          </Button>
          <Button onClick={() => actions.rotate(-1)} title="Turn a quarter clockwise (Shift+R)">
            Turn &#8635;
          </Button>
          <Button kind="danger" onClick={actions.deleteSelection} title="Remove (Delete)">
            Remove
          </Button>
        </div>
      </div>
    </>
  );
}

/** Groups as chips: lit when every selected part is in it, dashed when some are. A click puts them all in, or takes them all out. */
function Groups({ draft, ids, actions }: { draft: Blueprint; ids: string[]; actions: Pick<PartActions, 'addTag' | 'removeTag'> }) {
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Before paint, so the first keys typed land in the field and not on the board.
  useLayoutEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  const groups = groupsOf(draft);
  return (
    <div class="sec">
      <div class="h">
        Groups <span>name parts to drive them together</span>
      </div>
      {groups.map((g) => {
        const mine = g.ids.filter((id) => ids.includes(id)).length;
        const all = mine === ids.length;
        return (
          <button
            type="button"
            key={g.tag}
            class={`chip${all ? ' on' : mine > 0 ? ' part' : ''}`}
            aria-pressed={all}
            title={all ? `In "${g.tag}". Click to take ${ids.length === 1 ? 'it' : 'them'} out.` : `Click to add ${ids.length === 1 ? 'it' : 'them'} to "${g.tag}".`}
            onClick={() => (all ? actions.removeTag(ids, g.tag) : actions.addTag(ids, g.tag))}
          >
            {g.tag}
            <span class="n">{mine > 0 && !all ? `${mine}/${ids.length}` : g.ids.length}</span>
          </button>
        );
      })}
      {adding ? (
        <input
          ref={input}
          class="field chip-input"
          placeholder="group name, then Enter"
          aria-label="new group name"
          spellcheck={false}
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            const el = e.target as HTMLInputElement;
            if (e.key === 'Enter') {
              const t = el.value.trim();
              if (t !== '') actions.addTag(ids, t);
              setAdding(false);
            } else if (e.key === 'Escape') setAdding(false);
          }}
        />
      ) : (
        <button type="button" class="chip add" onClick={() => setAdding(true)}>
          + new group
        </button>
      )}
    </div>
  );
}

/** How full a bar is for a number with no top: it fills quickly at first and reaches the end at `full`. */
function fill(value: number, full: number): number {
  return value <= 0 ? 0 : Math.min(1, Math.log1p(value) / Math.log1p(full));
}

function RobotTab({ store, registry, select }: { store: Store<AppState>; registry: PartRegistry; select(ids: string[]): void }) {
  const stats = useStore(store, (s) => s.builder.stats);
  const draft = useStore(store, (s) => s.builder.draft);
  const icons = useStore(store, (s) => s.icons);
  const lasts = stats.fullDraw > 0 ? stats.energy / stats.fullDraw : undefined;
  // Balance: where the weight sits across the robot's width, from its left edge to its right edge.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of draft.parts) {
    for (const c of registry.has(p.part) ? partCells(p, registry).map((x) => x.cell) : [p]) {
      lo = Math.min(lo, c.x - 0.5);
      hi = Math.max(hi, c.x + 0.5);
    }
  }
  const off = stats.massKg > 0 ? stats.comX - (lo + hi) / 2 : 0;
  const at = stats.massKg > 0 && hi > lo ? (stats.comX - lo) / (hi - lo) : 0.5;
  const kinds = new Map<string, string[]>();
  for (const p of draft.parts) kinds.set(p.part, [...(kinds.get(p.part) ?? []), p.id]);
  const order = registry.ids();
  const groups = groupsOf(draft);
  return (
    <>
      <div class="sec">
        <div class="h">
          Robot <span>{plural(stats.parts, 'part')}</span>
        </div>
        <div class="kv">
          <span>Mass</span>
          <b>{num(stats.massKg, 1)} kg</b>
        </div>
        <div class="bar" title="The bar is full at 1000 kg">
          <i style={{ width: `${fill(stats.massKg, 1000) * 100}%` }} />
        </div>
        <div class="kv">
          <span>Energy</span>
          <b>{num(stats.energy)}</b>
        </div>
        <div class="bar" title="What its cores and batteries hold. The bar is full at 60000.">
          <i style={{ width: `${fill(stats.energy, 60000) * 100}%` }} />
        </div>
        <div class="kv" title={`With every part working at full power it uses ${num(stats.fullDraw)} a second`}>
          <span>Lasts at full power</span>
          <b>{stats.parts === 0 ? 'nothing to run' : lasts === undefined ? 'does not run down' : formatDuration(lasts)}</b>
        </div>
        <div class="bar" title="The bar is full at 10 minutes">
          <i style={{ width: `${(stats.parts === 0 ? 0 : lasts === undefined ? 1 : fill(lasts, 600)) * 100}%` }} />
        </div>
        <div class="kv" title={stats.massKg > 0 ? `Its weight sits at cell ${stats.comX.toFixed(2)}, ${stats.comY.toFixed(2)} (the round mark on the board)` : ''}>
          <span>Balance</span>
          <b>{stats.massKg === 0 ? 'nothing to weigh' : Math.abs(off) < 0.05 ? 'centered' : `${num(Math.abs(off), 1)} ${Math.abs(off) < 1.05 && num(Math.abs(off), 1) === '1' ? 'cell' : 'cells'} ${off > 0 ? 'right' : 'left'}`}</b>
        </div>
        <div class="bar" title="Left edge to right edge of the robot; the mark is where its weight sits">
          <span class="mid" />
          {stats.massKg > 0 && <span class="mark" style={{ left: `${at * 100}%` }} />}
        </div>
      </div>
      <div class="sec">
        <div class="h">
          Parts on it <span>click a kind to select them all</span>
        </div>
        {kinds.size === 0 && <p class="dim">Nothing yet. Take a part from the drawer and click on the board.</p>}
        {[...kinds]
          .sort(([a], [b]) => (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b)))
          .map(([type, ids]) => (
            <button type="button" class="kind-row" key={type} onClick={() => select(ids)} title={`Select ${ids.length === 1 ? 'it' : `all ${ids.length}`}`}>
              <Sprite src={icons[type]} size={20} />
              <span>{registry.has(type) ? registry.get(type).name : type}</span>
              <b>{ids.length}</b>
            </button>
          ))}
      </div>
      <div class="sec">
        <div class="h">
          Groups <span>click one to select its parts</span>
        </div>
        {groups.length === 0 && <p class="dim">No groups yet. Select parts and name a group to drive them together.</p>}
        {groups.map((g) => (
          <button type="button" class="chip" key={g.tag} onClick={() => select(g.ids)}>
            {g.tag}
            <span class="n">{g.ids.length}</span>
          </button>
        ))}
      </div>
    </>
  );
}
