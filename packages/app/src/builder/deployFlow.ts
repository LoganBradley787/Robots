import type { Issue } from '@robots/sim-core';

export type DeployDecision = { step: 'blocked'; errors: number } | { step: 'confirm-unsaved' } | { step: 'place' };

/**
 * Test (it was Deploy), per docs/design/10: validation errors block it; unsaved changes open the small box at the
 * button (M16: Save and test, Test anyway, Cancel); then the ghost goes on the cursor in the world. Warnings (a
 * core-less bomb) do not block. With nothing unsaved it goes straight through.
 */
export function deployDecision(issues: readonly Issue[], dirty: boolean): DeployDecision {
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (errors > 0) return { step: 'blocked', errors };
  return dirty ? { step: 'confirm-unsaved' } : { step: 'place' };
}

/** Drop points snap to 0.1 m so placement is repeatable. */
export function snapDrop(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x * 10) / 10 + 0, y: Math.round(p.y * 10) / 10 + 0 };
}

/** What the Test box offers when the robot has unsaved changes (M16). */
export type TestChoice = 'save' | 'anyway' | 'cancel';

/** The box at the Test button: what it says and its three choices, in the order shown. No "don't ask again". */
export const TEST_BOX: { text: string; choices: ReadonlyArray<{ value: TestChoice; label: string; title: string }> } = {
  text: 'Not saved.',
  choices: [
    { value: 'save', label: 'Save and test', title: 'Write the file, then try it in the world' },
    { value: 'anyway', label: 'Test anyway', title: 'Try it as it is on screen. The file stays as it was. Enter does this.' },
    { value: 'cancel', label: 'Cancel', title: 'Stay in the builder' },
  ],
};

/**
 * What a key does while the Test box is open: Enter means Test anyway and Esc means Cancel. Enter never saves,
 * whichever button has the focus; no other key chooses anything.
 */
export function testBoxKey(key: string): TestChoice | undefined {
  if (key === 'Enter') return 'anyway';
  if (key === 'Escape') return 'cancel';
  return undefined;
}

/**
 * Carries out a choice of the Test box. Save and test goes into the world only when the save went through (a Save As
 * called off, or a file that cannot be written, leaves you in the builder); Test anyway never touches the file.
 */
export async function testChoice(choice: TestChoice, deps: { save(): Promise<boolean>; test(): void | Promise<void> }): Promise<'tested' | 'stayed'> {
  if (choice === 'cancel') return 'stayed';
  if (choice === 'save' && !(await deps.save())) return 'stayed';
  await deps.test();
  return 'tested';
}
