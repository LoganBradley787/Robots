# M2 Builder Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Read `CLAUDE.md`, `docs/START-HERE.md`, `docs/status.md`, and `docs/design/10-builder.md` first. Tests first for every pure module, one commit per task (`M2 T<n>: <what>`), tree green at every commit, `docs/status.md` updated at session end.

**Goal:** A builder screen where Logan makes robots by picking and painting parts, tags them, sets bindings, sees mass, balance, and validator issues live, saves them as files in `blueprints/` with explicit Save and Save As, and deploys them into the world by dropping a ghost. Ends at Gate 2 (Builder).

**Spec:** `docs/design/10-builder.md` (the decisions Logan made; this plan implements it), `02` (blueprint format, validator, helpers), `07` Q3, Q9, Q20, `08` (UI conventions, persistence), `01` (render reads sim, UI sends commands).

**Written by:** an Opus 5.5 coding session, 2026-09-23, after Logan answered the builder questions.

## Global constraints (in addition to M0 and M1)

- Pure logic lives in pure modules with tests: blueprint edits and mirror in `sim-core/src/blueprint/`, editor state, history, and the deploy flow in `packages/app/src/builder/` with no Pixi or DOM imports. Pixi and Preact files only draw and forward input.
- The UI never mutates sim objects. The builder edits a `Blueprint` value; the world only changes through `World.spawnBlueprint`.
- Keyboard shortcuts are ignored while a text field has focus.
- Blueprint files: never write outside `blueprints/`; names are slugged; every write is a full JSON document ending in a newline.
- No em dashes anywhere.

## Decisions made in this plan (Claude's call, overturnable at Gate 2)

1. UI panels use Preact (`preact` 10.29.8, `@preact/preset-vite` 2.10.6, per `08`), as a sibling of the canvas with `pointer-events: none` except on panels. State flows through one small store (`useSyncExternalStore`-style subscribe), not a framework store library.
2. Builder canvas reuses the Pixi application: a `builderScene` container shown instead of the world container. Its own camera (same pure camera math), cell size 1 m, part sprites from the parts sheet.
3. Layout: palette as a vertical strip on the left (icon, name, number key), a top bar (blueprint dropdown, New, Save, Save As, Delete, dirty dot, Deploy), a right panel with three sections (Selection and tags, Bindings, Issues), stats in the bottom left of the canvas. Background `#13203a` with 1 m lines and brighter 5 m lines.
4. Edits are whole-blueprint immutable updates; history is a list of snapshots (blueprints are small). A drag gesture is one history entry.
5. Painting over an occupied cell replaces the part unless it is the same part and rotation (then nothing happens). Erasing removes the part covering the cell.
6. New parts get default ids (`part@x,y`). Moving a part is erase plus place (no move tool in M2).
7. Mirror axis is stored in half cells, defaults to the primary core's column center (or x = 0), shifted with `[` and `]` while mirror mode is on. Mirroring a part whose mirrored cell is the same cell (on the axis) places it once, mirrored rotation applied only if the part is not symmetric about the axis.
8. Saving writes the grid form when `toGrid` can express the blueprint, else the `parts` form. Tags that are not implicit go into generated legend entries (existing behavior of `toGrid`).
9. Deploy with errors is blocked and the Issues panel is flashed. Deploy with warnings only (for example `NO_CORE`) proceeds.
10. The world starts with terrain only; the app opens in the builder on a blank blueprint. World `R` now clears robots and rebuilds the world without reloading the page (a reload would lose the builder draft).
11. Spawns are recorded in a `World.spawnLog` (tick, blueprint, position) so a later replay runner can reproduce them. Not hashed.
12. Deleting a blueprint file is allowed with a confirm dialog (git keeps history).

## File structure

```
packages/sim-core/src/blueprint/edit.ts        placePart, erasePart, rotateCell helpers, setTags, blankBlueprint
packages/sim-core/src/blueprint/mirror.ts      mirrorRotation, mirrorPart, mirrorBlueprint
packages/sim-core/src/blueprint/stats.ts       staticStats(bp, registry): parts, mass, center of mass
packages/sim-core/src/blueprint/serialize.ts   toFileJson(bp, registry): grid form when possible, else parts form
packages/sim-core/src/physics/PhysicsWorld.ts  + overlapsBoxes(boxes): boolean
packages/sim-core/src/world/World.ts           + canPlace(raw, at), spawnLog
packages/app/vite-plugins/blueprintStore.ts    dev endpoints over blueprints/
packages/app/src/storage/blueprintApi.ts       fetch client, slug(name)
packages/app/src/builder/editorState.ts        EditorState, reducer: tool, held part, rotation, selection, mirror, gestures
packages/app/src/builder/history.ts            undo/redo stacks of blueprints
packages/app/src/builder/document.ts           open file, dirty tracking, save / save as / new / delete flows (pure state machine)
packages/app/src/builder/deployFlow.ts         deploy steps as a pure state machine
packages/app/src/builder/BuilderScene.ts       Pixi: grid, parts, ghost, selection box, mirror axis, COM marker, issue outlines
packages/app/src/ui/store.ts                   tiny observable store
packages/app/src/ui/App.tsx, TopBar.tsx, Palette.tsx, SidePanel.tsx, BindingsPanel.tsx, IssuesPanel.tsx, Dialog.tsx, StatsBadge.tsx
packages/app/src/world/SpawnGhost.ts           ghost robot following the cursor, placement check
packages/app/src/main.ts                       modes, Tab toggle, wiring
```

## Task dependencies

T1 and T2 and T3 are independent. T4 needs T1. T5 needs T4. T6 needs T3, T5. T7 needs T5. T8 needs T6. T9 needs T2, T6. T10 needs all.

---

### Task 1: Blueprint edit operations, mirror, static stats, file serialization (sim-core, pure)

**Interfaces:**
```ts
blankBlueprint(name: string): Blueprint
partAt(bp, registry, x, y): PlacedPart | undefined                  // part covering the cell
placePart(bp, registry, part: string, x, y, rot): Blueprint           // replaces whatever covers those cells; no-op if identical
erasePartAt(bp, registry, x, y): Blueprint
setPartTags(bp, ids: string[], tags: string[]): Blueprint             // explicit tags; the implicit id tag is always kept
setPartRotation(bp, registry, id, rot): Blueprint
setBindings(bp, bindings: Binding[]): Blueprint
mirrorRotation(rot): Rotation                                         // (360 - rot) % 360 for parts symmetric about their vertical axis
mirrorX(x, axisHalfCells): number                                     // axisHalfCells / 2 is the axis x; x' = axis*2 - x
staticStats(bp, registry): { parts: number; massKg: number; comX: number; comY: number }   // footprint cells, def masses
toFileJson(bp, registry): object                                      // { format, name, grid, legend?, bindings?, scripts?, primaryCore?, corePriority? } or parts form
```
Placing keeps blueprint order stable: a new part is appended; a replaced part is removed then the new one appended. Ids stay default `part@x,y`, so ids and tags survive save and reload.

**Tests first:** place into empty; place over a different part replaces it and drops its tags; place identical is the same object (no history entry later); erase; tags keep the id tag and dedupe; mirrorRotation of 0/90/180/270; mirror of `T>` at x=0 across axis x=2 gives a `T<` at x=4; staticStats of the car (12 kg, COM (2.542, 0.75)); toFileJson of the car round-trips through `expandBlueprint` to the same parts, bindings, and name, and uses the grid form; a blueprint with a part at x=-1 uses the parts form.

---

### Task 2: Placement checks and spawn log (sim-core)

- `PhysicsWorld.overlapsBoxes(boxes: { x: number; y: number; hx: number; hy: number }[]): boolean` using `intersectionsWithShape` with a cuboid per cell, shrunk by 0.02 so touching is allowed.
- `World.canPlace(raw, at): { ok: boolean; reason?: string }`: validates (errors give the first issue's message), then checks every part cell's world box (and wheel balls as their cell box) against existing colliders, terrain included.
- `World.spawnLog: { tick; name; at; blueprint }[]`, appended by `spawnBlueprint`.
- `World.reset()` is not added; the app recreates the `World` for `R`.

**Tests first:** the car can be placed at (0, 3) on the flat world and not at (0, 0.5) (it would overlap the ground); not on top of an already spawned car; resting against the ground (core at y 1.45) is allowed after the first car is removed (use a fresh world); spawnLog records name, tick, and position.

---

### Task 3: Blueprint file store (dev server)

- `packages/app/vite-plugins/blueprintStore.ts`: a Vite plugin with `configureServer` middleware on `/api/blueprints`. `GET /api/blueprints` returns `[{ file, name }]` sorted by name (name from the JSON, else the file stem). `GET /api/blueprints/:file` returns the JSON. `PUT /api/blueprints/:file` with a JSON body validates it parses as an object, writes `JSON.stringify(body, null, 2) + '\n'`. `DELETE` removes the file. Files outside `blueprints/`, names not matching `^[a-z0-9][a-z0-9-]*\.json$`, and bodies over 1 MB are rejected with 400. The handler is a plain function `(req, dir) => response` so it is tested without Vite.
- `packages/app/src/storage/blueprintApi.ts`: `list()`, `load(file)`, `save(file, json)`, `remove(file)`, and `slug(name)` (lowercase, spaces and underscores to dashes, strip others, collapse dashes, `blueprint` if empty).
- `vite.config.ts` registers the plugin; the repo root `blueprints/` is the directory.

**Tests first (node):** the handler lists, reads, writes, and deletes in a temp directory; rejects `../x.json`, `a/b.json`, `X.JSON`, non-JSON bodies; slug cases (`"Heat Seeker 2"` to `heat-seeker-2`, `"!!!"` to `blueprint`).

---

### Task 4: App shell: modes, Preact, store, keyboard focus

- Add `preact` and `@preact/preset-vite` (exact pins from `08`), JSX settings in the app tsconfig (`jsx: react-jsx`, `jsxImportSource: preact`).
- `ui/store.ts`: `createStore<T>(initial)` with `get`, `set(partial or updater)`, `subscribe`, and a `useStore(store, selector)` hook.
- App state: `mode: 'builder' | 'world'`. `Tab` toggles (prevent default). Entering the builder pauses the world; returning restores the previous paused flag.
- `index.html` gets `<div id="ui">`; the canvas stays full screen; the HUD shows only in world mode.
- `keys.ts` ignores events whose target is an input, textarea, select, or contenteditable.
- World starts with terrain only, app opens in builder. World `R` recreates the world (terrain, no robots) without a page reload.

**Tests first:** the store notifies subscribers and selectors; the mode toggle and pause restore logic as a pure function; the key filter ignores inputs.

**Done when:** `Tab` flips between an empty builder canvas (dark blue) and the world with no errors.

---

### Task 5: Builder canvas: grid, painting, erasing, rotating, undo

- `builder/editorState.ts` (pure): `{ held?: { part; rot }, hover?: cell, gesture?: 'paint' | 'erase' | 'select', selection: string[], mirror: { on; axisHalfCells } }` and a reducer for pointer down, move, up, key presses. Painting applies `placePart` at each newly entered cell (and the mirrored cell when mirror is on). Right button erases the same way. `R`, `Shift+R`, `Esc`, number keys 1 to 8 pick parts in registry order.
- `builder/history.ts` (pure): `commit(bp)` pushes if different, `beginGesture` and `endGesture` coalesce a drag into one entry, `undo`, `redo`, capped at 200 entries.
- `BuilderScene.ts`: grid (1 m faint, 5 m brighter, axis lines at x = 0 and y = 0 slightly brighter), parts as sprites (same frames and rotations as `RobotView`, mount sprites on the parent cell side), a translucent ghost of the held part at the hover cell (red tint when it would replace a different part), camera pan with middle or space-drag, wheel zoom.
- Cell picking uses the pure `screenToWorld` then `Math.floor(x + 0.5)`.

**Tests first:** reducer paints a horizontal drag into consecutive cells; one drag gives one undo step; undo then redo restores; right-drag erases; rotate cycles 0, 90, 180, 270 and back; number keys pick parts in order; with mirror on, painting at x=0 across axis x=2 also paints x=4 with the mirrored rotation.

**Done when:** in the browser, painting a car by hand takes a few seconds and undo works.

---

### Task 6: Palette, top bar, documents, dialogs, issues, stats

- `Palette.tsx`: one button per registry part (sprite icon from the sheet, name, number key), highlighting the held part.
- `builder/document.ts` (pure): `{ file?: string, name, saved: Blueprint, draft: Blueprint }`, `dirty = !equal(saved, draft)`. Flows: `open(file)`, `newBlank()`, `save()`, `saveAs(name)`, `delete()`, each returning either a result or `{ needs: 'confirm-unsaved' }` so the UI asks Save / Don't save / Cancel. Save As never touches the old file; if the slug exists, it asks to overwrite.
- `TopBar.tsx`: blueprint dropdown (from `list()`), New, Save, Save As (name dialog), Delete (confirm), a dirty dot, the name, Deploy.
- `Dialog.tsx`: modal with buttons; focus trapped; `Enter` and `Esc`.
- `IssuesPanel.tsx`: `validateBlueprint` on every draft change; errors and warnings listed; clicking one selects the part and pans to it. `BuilderScene` outlines issue cells in red (errors) or amber (warnings).
- `StatsBadge.tsx` plus a COM marker in the scene from `staticStats`.

**Tests first:** document flows: open while dirty asks; Save As writes a new file and leaves the old one, and the document now points at the new file; Save on a new blueprint behaves like Save As; delete asks to confirm; dirty flips on edit and clears on save.

**Done when:** in the browser, the car opens from the dropdown, an edit shows the dirty dot, Save As `car-2` creates `blueprints/car-2.json` and `car.json` is unchanged, and a broken edit shows an issue with the cell outlined.

---

### Task 7: Selection, tags, mirror mode

- With nothing held, click selects a part (Shift adds), drag draws a selection box. `Delete` or `Backspace` removes the selection. `R` rotates selected parts in place.
- `SidePanel.tsx` Selection section: for one part, id, part name, rotation buttons; for many, the count. Tags: chips with remove buttons plus an input to add a tag to every selected part (existing tags suggested).
- Mirror mode: `M` toggles; the axis is drawn as a dashed vertical line; `[` and `]` move it by half a cell (in world mode those keys still change time scale; in builder mode they move the axis). Status shown in the stats badge.

**Tests first:** box select collects parts inside the box; tagging many parts adds to each and keeps id tags; delete selection is one undo step; mirror axis default is the core's column; `[` and `]` shift by half cells.

---

### Task 8: Bindings panel (data only)

- `BindingsPanel.tsx`: list rows of key (captured by pressing a key into a small field), mode (hold, toggle, pulse), target (dropdown of tags in the blueprint), channel (dropdown of input channels available on parts with that tag), value (number, clamped to the channel range shown as a hint). Add and remove rows. Script bindings are hidden until M5.
- Edits go through `setBindings` and history. The validator's binding issues show in the Issues panel.
- Note in the panel: "Keys do nothing until M3."

**Tests first:** the pure helpers: tags in a blueprint, channels available for a tag (union over tagged parts, from defs), a new default binding targets the first tag and its first channel.

---

### Task 9: Deploy and the spawn ghost

- `builder/deployFlow.ts` (pure): `start(draft, dirty)` goes to `blocked(issues)` on errors, `confirm-unsaved` when dirty, else `placing(blueprint)`. Save or Don't save continue to `placing`; Cancel returns to idle.
- Entering `placing` switches to world mode (paused state restored) with a `SpawnGhost`: the robot's sprites at 50 percent alpha with the primary core at the cursor (snapped to 0.1 m), green when `world.canPlace` is ok and red otherwise, with the reason in the HUD. Click drops it (`spawnBlueprint`), which ends placing. `Esc` cancels. `Tab` back to the builder keeps the draft.
- New robots get a `RobotView`; the camera target switches to the new robot.

**Tests first:** the flow transitions for errors, warnings only, dirty with each answer, and cancel.

**Done when:** in the browser, build a car, Deploy, Don't save, drop it mid-air, it falls and rests; `Tab` back shows the same draft with the dirty dot still on.

---

### Task 10: Polish, docs, CI, tag, Gate 2

- Look pass on the builder: spacing, palette icons crisp, panels readable on a 1280 wide window, dark blue theme consistent with the world HUD.
- README: builder controls and the save model. `docs/status.md`: Gate 2 instructions.
- Demo checklist (record in status): build a new robot from blank, tag its wheels, add two bindings, Save As `test-bot`, reopen it from the dropdown, Deploy, drop it, it rests; open `car`, delete everything but one wheel and the core, Deploy with Don't save, then confirm `blueprints/car.json` is unchanged; undo and redo across a drag; mirror mode builds a symmetric robot.
- Full checks, commit, `git tag m2`, push, CI green.
- Opus review of the milestone before tagging, findings fixed.

## Self-review notes

- `10-builder.md` coverage: separate screen and Tab (T4), blueprint dropdown and blank default (T6), explicit Save and Save As with the original untouched (T6), unsaved prompts on open, new, and deploy (T6, T9), pick then paint with drag and right-click erase and R rotate (T5), mirror and live stats (T6, T7), validator with outlines (T6), bindings data (T8), deploy in three steps with ghost and overlap refusal (T9), files in `blueprints/` (T3), no ASCII box and no test drop (not built).
- `06` M2 done-when (built in the editor, saved, reloaded, spawned, rests, without touching a file) is the T10 demo checklist.
- Risks: Preact under TS 7 JSX settings (verify in T4 before building panels); `intersectionsWithShape` callback semantics in 0.20.0 (verify in T2 with a probe first).
