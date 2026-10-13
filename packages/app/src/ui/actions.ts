import type { Issue } from '@robots/sim-core';
import type { InspectorTab } from './appState';

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
  /** Test (it was Deploy): into the world with this robot in hand. */
  deploy(): void;
  /** The top strip's Script button: the code editor when there is one script, else the Behaviors tab. */
  script(): void;
  focusIssue(issue: Issue): void;
  /** Selects these parts on the board. */
  select(ids: string[]): void;
  showTab(tab: InspectorTab): void;
  /** Puts a part on a hotbar slot (0 to 8); null empties it. */
  setHotbarSlot(slot: number, part: string | null): void;
  swapHotbarSlots(a: number, b: number): void;
  /** Asks for the pictures and counts of these saved robots (the library and the Assemblies tab). */
  needMeta(files: string[]): void;
}
