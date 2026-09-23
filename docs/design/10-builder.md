# 10 Builder

Status: decided with Logan, 2026-09-23 (before the M2 plan). Supersedes the M2 bullets in `06` where they differ.

## Why a separate screen
Logan: building is more than dragging pieces. Later it means scripts and sensor logic (a heat-seeking missile has to read sensors and correct for gravity). Doing that inside the world is cramped and awkward, and redoing it every time is worse. So blueprints are designed once in a dedicated builder, saved, and deployed.

## Screens
- Two screens: the world and the builder. `Tab` flips between them. The world keeps its robots and is paused while the builder is open.
- The app opens in the builder on a blank blueprint. The world starts with terrain only.
- Builder look: dark blue background with a laid-out grid (exact look is Claude's call, judged at Gate 2).

## Blueprints and files
- Blueprints are files in the repo's `blueprints/` folder, read and written through a small dev-server endpoint. Claude reads what Logan builds and Logan opens what Claude writes. Git keeps history.
- A dropdown lists every blueprint. The builder starts on a blank one; picking one opens it.
- Saving is explicit (Logan's call, overriding autosave): **Save** overwrites the open blueprint's file. **Save As** asks for a name and writes a new file; the original stays unchanged. Reason, in Logan's words: open the aircraft carrier, delete everything but one missile to try something, deploy it, and autosave would have destroyed the carrier.
- Unsaved changes are never lost silently: switching blueprints, starting a new one, or deploying with unsaved changes asks **Save / Don't save / Cancel**. "Don't save" keeps the file as it was and continues with the edited version (deploying it, or discarding it when switching).
- Files are written in the grid form when it can express the blueprint (readable for Claude and in diffs), else the `parts` form.

## Placing parts: pick then paint
- Click a part in the palette (or press its number key) to hold it. Click a cell to place it; hold and drag to place a run of them. A ghost shows where it goes and whether it fits.
- Erasing is the eraser tool (`E`, then left-click or drag); right-click opens the part menu (changed in M3, see `11`). `R` rotates the held part (`Shift+R` the other way). `Esc` drops what you are holding.
- With nothing held, click selects a part; drag selects a box of parts. The part menu (right-click, `11`) edits the selection's tags, auto controls, and rotation.
- Undo and redo (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`). One drag is one undo step.

## Helpers
- Mirror mode (`M`): everything placed or erased is mirrored across a vertical axis, with thrusters, wheels, and decouplers flipped to match. The axis defaults to the core's column and can be shifted by half cells.
- Live stats: part count, total mass, and the center of mass drawn as a marker on the grid, updating as you build.
- Live validator: the issue list updates on every change; bad cells are outlined, and clicking an issue highlights its part.
- Bindings panel: add, edit, and remove key bindings (key, mode, target tag, channel, value). Data only until M3 makes keys do something.
- Not in M2: an ASCII text box (clunky for people; the grid text stays the format for files, the CLI, and Claude), and a test drop inside the builder (deploy is fast enough).

## Deploy
Three steps, per Logan:
1. Click **Deploy**. Validation errors block it and are shown.
2. If there are unsaved changes: Save / Don't save / Cancel.
3. The world opens with a ghost of the robot on the cursor (primary core on the cursor, mid-air allowed). Click to drop it; overlapping anything is refused; `Esc` cancels.

Robots are deployed only from the builder (Logan declined a quick-spawn menu in the world for now).
