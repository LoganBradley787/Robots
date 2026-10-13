import type { Issue } from '@robots/sim-core';
import type { InspectorTab } from './appState';
import type { GroupOffer } from '../builder/boardOps';
import type { NameFix, ScriptProblem } from '../builder/scriptView';

/** What the builder's panels can ask for. `main.ts` wires each to the builder, the document, or the store. */
export interface BuilderActions {
  hold(part: string): void;
  /** Holds a copy of a saved robot to place inside this one (M7). */
  holdBlueprint(file: string): void;
  /** Which core the Keys and Behaviors tabs edit; undefined is the main core. */
  setControlsFor(core: string | undefined): void;
  eraser(): void;
  /** Puts down whatever is in hand (a part, the eraser, a held robot). */
  putDown(): void;
  toggleMirror(): void;
  undo(): void;
  redo(): void;
  open(file: string): void;
  newBlank(): void;
  save(): void;
  saveAs(): void;
  remove(): void;
  /** Gives the open robot a new name. Its file keeps its name until Save As. */
  rename(name: string): void;
  /** Sets what kind of robot the open one is; undefined clears it. */
  setKind(kind: string | undefined): void;
  /** Sets the kind of a saved robot that is not open, in its file. */
  setFileKind(file: string, kind: string | undefined): void;
  /** Test (it was Deploy): into the world with this robot in hand. With unsaved changes it opens the box at the button first. */
  deploy(): void;
  /** A choice made in the Test box: save and test, test anyway, or cancel. */
  testChoice(choice: 'save' | 'anyway' | 'cancel'): void;
  /** The top strip's Script button: the code editor when there is one script, else the Behaviors tab. */
  script(): void;
  focusIssue(issue: Issue): void;
  /** Lights up on the board what a script of the core in the panels reaches; undefined puts the light out. */
  showScript(id: string | undefined): void;
  /** Turns the Behaviors tab to a script (of the given core) and lights up what it reaches. */
  revealScript(core: string | undefined, id: string): void;
  /** Opens the script a problem is about, at its line. */
  openProblem(problem: ScriptProblem): void;
  /** Points a dead name at a real one: only that exact quoted text is rewritten. One undo step. */
  fixName(fix: NameFix): void;
  /** Accepts an offer made at the cursor: the parts just placed join the group. */
  acceptOffer(offer: GroupOffer): void;
  dismissNote(seq: number): void;
  dismissCursorNote(seq: number): void;
  /** A copy of the selection goes into the hand (Cmd+D). */
  duplicate(): void;
  /** Selects these parts on the board. */
  select(ids: string[]): void;
  showTab(tab: InspectorTab): void;
  /** Puts a part on a hotbar slot (0 to 8); null empties it. */
  setHotbarSlot(slot: number, part: string | null): void;
  swapHotbarSlots(a: number, b: number): void;
  /** Asks for the pictures and counts of these saved robots (the library and the Assemblies tab). */
  needMeta(files: string[]): void;
}

/** What the inspector's Part tab can do to the selected parts (it was the floating part menu). */
export interface PartActions {
  addTag(ids: string[], tag: string): void;
  removeTag(ids: string[], tag: string): void;
  setAuto(ids: string[], on: boolean): void;
  /** M10: start these parts (ones that need arming) armed or not. */
  setArmed(ids: string[], on: boolean): void;
  /** M12: what these fabricators build: a saved blueprint's file, a recipe the blueprint has, or nothing. */
  setMakes(ids: string[], choice: { file: string } | { recipe: string } | undefined): void;
  /** M12: grow or shrink these stretchy parts' hollows, each from its own size. */
  resize(ids: string[], dw: number, dh: number): void;
  rotate(dir: 1 | -1): void;
  deleteSelection(): void;
  /** Swap to: these parts become another type where they stand, keeping what still applies. */
  swapTo(ids: string[], type: string): void;
}
