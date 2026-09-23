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
    await this.deps.api.save(file, toFileJson(draft, this.deps.registry));
    this.savedJson = this.serialize(draft);
    return true;
  }

  async saveAs(): Promise<boolean> {
    const answer = await this.deps.askName(this.state.name);
    const name = answer?.trim();
    if (!name) return false;
    const file = fileForName(name);
    if (file !== this.state.file) {
      const existing = await this.deps.api.list();
      if (existing.some((b) => b.file === file) && !(await this.deps.confirm(`A blueprint named "${name}" already exists. Replace it?`))) {
        return false;
      }
    }
    const renamed = { ...this.deps.getDraft(), name };
    await this.deps.api.save(file, toFileJson(renamed, this.deps.registry));
    this.deps.setDraft(renamed, { keepHistory: true });
    this.state = { file, name };
    this.savedJson = this.serialize(renamed);
    return true;
  }

  async remove(): Promise<boolean> {
    const file = this.state.file;
    if (file === undefined) return false;
    if (!(await this.deps.confirm(`Delete "${this.state.name}"? This removes blueprints/${file}.`))) return false;
    await this.deps.api.remove(file);
    this.startBlank();
    return true;
  }
}
