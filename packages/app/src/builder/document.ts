import { blankBlueprint, expandBlueprint, toFileJson, type Blueprint, type PartRegistry } from '@robots/sim-core';
import { fileForName, type BlueprintListing } from '../storage/blueprintApi';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface DocumentDeps {
  registry: PartRegistry;
  api: {
    list(): Promise<BlueprintListing[]>;
    load(file: string): Promise<unknown>;
    save(file: string, json: unknown): Promise<void>;
    remove(file: string): Promise<void>;
  };
  getDraft(): Blueprint;
  /** `keepHistory` is true for a rename during Save As; false when a different blueprint is loaded. */
  setDraft(bp: Blueprint, opts?: { keepHistory: boolean }): void;
  /** Renames every undo step too, so undoing after Save As never brings back the old name. */
  renameHistory?(name: string): void;
  askUnsaved(): Promise<UnsavedChoice>;
  askName(current: string): Promise<string | null>;
  confirm(message: string): Promise<boolean>;
  /** Shown when a file cannot be opened. */
  notify?(message: string): void;
}

export interface DocumentState {
  /** The file this draft was opened from or last saved to; absent for a never-saved blueprint. */
  file?: string;
  name: string;
}

/**
 * The open blueprint and its file: explicit Save and Save As, and Save / Don't save / Cancel before anything that
 * would lose edits. Save As writes a new file and never touches the original (Logan's rule, docs/design/10).
 */
export class DocumentController {
  state: DocumentState;
  private readonly deps: DocumentDeps;
  private savedJson: string;

  constructor(deps: DocumentDeps) {
    this.deps = deps;
    const draft = deps.getDraft();
    this.state = { name: draft.name };
    this.savedJson = this.serialize(draft);
  }

  /** A file that expandBlueprint would reject could never be opened again, so it is never written. */
  private writable(json: unknown): boolean {
    const { blueprint, issues } = expandBlueprint(json);
    if (blueprint) return true;
    this.deps.notify?.(`Cannot save yet: ${issues.map((i) => i.message).join('; ')}`);
    return false;
  }

  private serialize(bp: Blueprint): string {
    return JSON.stringify(toFileJson(bp, this.deps.registry));
  }

  isDirty(): boolean {
    return this.serialize(this.deps.getDraft()) !== this.savedJson;
  }

  /** Before leaving the current draft. True means go ahead ("Don't save" leaves the draft as it is). */
  async confirmLeave(): Promise<boolean> {
    if (!this.isDirty()) return true;
    const choice = await this.deps.askUnsaved();
    if (choice === 'save') return this.save();
    return choice === 'discard';
  }

  async open(file: string): Promise<boolean> {
    if (!(await this.confirmLeave())) return false;
    let raw: unknown;
    try {
      raw = await this.deps.api.load(file);
    } catch (e) {
      this.deps.notify?.(`Could not open ${file}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    const { blueprint, issues } = expandBlueprint(raw);
    if (!blueprint) {
      this.deps.notify?.(`${file} is not a readable blueprint: ${issues.map((i) => i.message).join('; ')}`);
      return false;
    }
    this.deps.setDraft(blueprint, { keepHistory: false });
    this.state = { file, name: blueprint.name };
    this.savedJson = this.serialize(blueprint);
    return true;
  }

  async newBlank(): Promise<boolean> {
    if (!(await this.confirmLeave())) return false;
    this.startBlank();
    return true;
  }

  private startBlank(): void {
    const bp = blankBlueprint('untitled');
    this.deps.setDraft(bp, { keepHistory: false });
    this.state = { name: bp.name };
    this.savedJson = this.serialize(bp);
  }

  async save(): Promise<boolean> {
    const file = this.state.file;
    if (file === undefined) return this.saveAs();
    const draft = this.deps.getDraft();
    const json = toFileJson(draft, this.deps.registry);
    if (!this.writable(json)) return false;
    await this.deps.api.save(file, json);
    this.savedJson = this.serialize(draft);
    return true;
  }

  async saveAs(): Promise<boolean> {
    const answer = await this.deps.askName(this.state.name);
    const name = answer?.trim();
    if (!name) return false;
    const file = fileForName(name);
    // Ask even when the name maps to the open file: Save As must never replace the original silently.
    const existing = (await this.deps.api.list()).find((b) => b.file === file);
    if (existing && !(await this.deps.confirm(`"${existing.name}" (blueprints/${file}) already exists. Replace it?`))) return false;
    const json = toFileJson({ ...this.deps.getDraft(), name }, this.deps.registry);
    if (!this.writable(json)) return false;
    await this.deps.api.save(file, json);
    // Rename after the write, from the current draft, so edits made while saving are kept.
    const renamed = { ...this.deps.getDraft(), name };
    this.deps.setDraft(renamed, { keepHistory: true });
    this.deps.renameHistory?.(name);
    this.state = { file, name };
    this.savedJson = JSON.stringify(json);
    return true;
  }

  /** Deletes the file. What's on screen stays as an unsaved blueprint, so nothing on screen is lost. */
  async remove(): Promise<boolean> {
    const file = this.state.file;
    if (file === undefined) return false;
    const msg = `Delete "${this.state.name}"? This removes blueprints/${file}. What's on screen stays, as an unsaved blueprint.`;
    if (!(await this.deps.confirm(msg))) return false;
    await this.deps.api.remove(file);
    this.state = { name: this.state.name };
    this.savedJson = this.serialize(blankBlueprint(this.state.name));
    return true;
  }
}
