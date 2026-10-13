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
- Files are written in the grid form when it can express the blueprint (readable for Claude and in diffs), else the `parts` form. Two parts on one cell is one of the things a grid cannot express (it would write one and lose the other), so such a blueprint is written in the `parts` form with both, and the issues list names the overlap (review E1).

## The board: one way of working (M16)
There are no modes. What a click does depends only on whether something is in the hand; the hand chip, the ghost and the hint line always say which.
- **Hand full** (a tile from the drawer, a hotbar key `1` to `9`, `Alt`+click on a part, `Cmd/Ctrl+D` on a selection, a saved robot, or the eraser `E`): a click or a drag places on empty cells, and one drag is one undo step. `R` and `Shift+R` turn it, `F` flips a held robot or a held copy, `Esc` or a right-click puts it down.
- **A taken cell refuses a placed part**, and says why at the cursor for about two seconds. **Shift while placing swaps**: the part there gives way and the new one keeps its place in the robot, its groups and the settings that still apply (`replacePartAt`). The same part already standing there is not a refusal, so a drag can pass over what it painted.
- **Hand empty**: a click selects a part, `Shift`+click adds or removes one, a drag across empty cells selects a box (a part is in the box when any of its cells is, review E4), and a drag that starts on a selected part moves the selection: it follows as outlines and lands on release. Blocked, it says why at the cursor and nothing moves. Arrow keys nudge the selection one cell, `R` turns it (a turn onto another part is refused whole, review E1), `Delete` removes it, `Cmd/Ctrl+D` puts a copy in the hand, `Cmd/Ctrl+A` selects everything. A right-click selects a part and turns the inspector to it. `Esc` calls off a drag, then lets go of the selection.
- **A move keeps the part**: its groups and settings travel, its id follows its cell, and every key that named the old id follows it (`movePartsBy`). Script code is never rewritten; a script that spells the old id is named in the notice after the move.
- **Copies carry everything.** `Alt`+click holds a copy of that very part (type, turn, groups, settings) and `Cmd/Ctrl+D` a copy of the selection (`stampOfParts`, `placePartStamp`). A copy of part of a named assembly joins it. A copy that holds all of a named assembly (every part that carries `gun-turret1`, as the Assemblies tab and `pnpm sim place` name what they place) is one more of them: it lands as `gun-turret13`, and a copied core brings its keys and scripts under the new name, so a script that finds turrets by name drives the new one by itself.
- **A plain tile is blank.** When it lands touching parts of its own type that all share a group, the builder offers "Add to group X" at the cursor: one click, easy to ignore.
- **Mirror** (`M`) is a switch with its line drawn. A place, a Shift swap, a move or nudge, and an erase happen on both sides, or not at all: a place with one side taken is refused whole, and a move takes the mirror image of each selected part the other way in the same step.
- **Swap to** (Part tab, for parts of one type): pick another part from a small picker with search. The part keeps its place, turn, groups and the settings the new one has too. When a key or a script drove it by its type name, the new part keeps that name as a group (`keepTypeTag`), so they still reach it. A swap that does not fit is refused with the reason.
- **No warnings before an edit; a notice after it**, with Undo in it, that goes away by itself: what a swap kept and dropped and what will not work on the new part (an input it lacks, a script's own `p.type === 'x'` test, which a group cannot satisfy); what drove a removed part and which names reach nothing now; which scripts still spell a moved part's old id.
- Undo and redo (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`) are whole actions: one drag, one move, one nudge, one swap, one accepted offer.
- The grid follows the view: the board has no edge.

## What a script drives (M16)
All of it reads names and inputs, never part types (`sim-core/src/script/reading.ts`).
- **Behaviors tab**: each script says what it drives ("Drives 12 parts"). Resting the mouse on it, or its **Show** switch, lights the board: the parts it reaches by a name written in its code get a solid blue frame and the rest of the robot steps back. `Esc` with an empty hand puts the light out.
- **A script that builds names in code** (`name + '.gun'`) says so: "this script also picks parts in its own code, so this list may be incomplete". The parts whose group fits a name it builds get a dashed frame (`partsBuiltTargetsFit`): likely, not sure.
- **Not driven**: a part of a type the script drives through a group, in none of its groups, gets an orange dashed frame and a row under the script with "Add to group X" (one undo step). Nothing is listed for a script that builds names in code or names the type itself: it may reach the part that way.
- **Part tab**: each input says what drives it today: its auto key, your keys, and the scripts that write it (a click shows that script in the Behaviors tab).
- **Problems** lists names in scripts that reach nothing (`scriptNameIssues`, folded over copies of one script), as warnings with the script, the line and the real names. A click opens the script with that line selected. When a real name is a letter or two away it offers "Point it at X": the line as it is and as it would be, and only that exact quoted text at that exact place is rewritten, as one undo step. Spare names are not problems.

## Placing a saved blueprint (M7)
- The palette's **Blueprints** section lists every saved blueprint except the open one. Click one to hold a copy (with its scripts); the ghost shows every part it adds, red where a click would be refused (an overlap). `R` and `Shift+R` turn it, `F` flips it left to right, a click places it as one undo step, and it stays held for the next one; `Esc` or picking a part lets go. In mirror mode a click also places its mirror image across the axis.
- Placed, it is ordinary parts of this robot (Logan: copies, never links). Editing `missile.json` later changes nothing already placed. Its parts carry the tag `missile1` (then `missile2`), and its core keeps its own controls (`02`, Placing).
- Erasing the main core hands the robot to the next core (the first one left, in part order), and that core's controls with it (review E3): its bindings and scripts move to the main core's, after the ones already there, and its own entry goes. A binding both had is kept once; a script id both had gets a new name (`guide-2`) that the moved bindings follow. A placed copy's bindings get its scope on their targets (`burn` becomes `missile1.burn`), so they still mean its own parts; the code of its scripts is not rewritten, so a script that names the copy's tags needs the scope added by hand.
- **Controls for:** when the robot has more than one core, the Controls and Scripts panels get a picker: main core, then each other core by its scope (`missile1 (core@8,6)`). Picking a core shows and edits its own bindings, auto controls switch, and scripts ("on at release" instead of "on at deploy"); binding targets are that copy's own tags. Adding controls to a core that had none gives it a `cores` entry. The script editor edits the picked core's script, so two missiles' `guide` scripts are separate, each saved to its own file (`launcher.missile1.guide.js`).

## Helpers
- Mirror mode (`M`): everything placed, swapped, moved or erased is mirrored across a vertical axis, with thrusters, wheels, and decouplers flipped to match, both sides or neither (see The board). The axis defaults to the core's column and can be shifted by half cells (`[` and `]`).
- Live stats: part count, total mass, and the center of mass drawn as a marker on the grid, updating as you build.
- Live validator: the issue list updates on every change; bad cells are outlined, and clicking an issue highlights its part.
- Bindings panel: add, edit, and remove key bindings (key, mode, target tag, channel, value). Data only until M3 makes keys do something.
- Not in M2: an ASCII text box (clunky for people; the grid text stays the format for files, the CLI, and Claude), and a test drop inside the builder (deploy is fast enough).

## Deploy
Three steps, per Logan:
1. Click **Deploy**. Validation errors block it and are shown.
2. If there are unsaved changes: Save / Don't save / Cancel.
3. The world opens with a ghost of the robot on the cursor (primary core on the cursor, mid-air allowed). Click to drop it; overlapping anything is refused; `Esc` cancels.
4. (M8, Logan) While the ghost is held, `F` flips it left to right and `R` turns it a quarter turn counterclockwise (the builder stamp's keys; they do not reach the robot you are driving). The world toolbar's **Deploy as: Yours / Enemy** sets its team. All three stick for the next deploy, saved in the browser. The deploy records the flipped and turned blueprint (`orientBlueprint` in `sim-core`), so replays need nothing new. Flipping keeps tags and scripts as they are, as the builder's mirror does. The flip is across the middle of the root part's cells (its own column for a one-cell root, between the two columns of a cannon), so the root stays where it is and flipping twice gives the same robot back (review E5).

Robots are deployed only from the builder (Logan declined a quick-spawn menu in the world for now).
