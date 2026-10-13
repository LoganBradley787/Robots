import { describe, expect, it } from 'vitest';
import { deployDecision, TEST_BOX, testBoxKey, testChoice, type TestChoice } from '../src/builder/deployFlow';

/** Runs a choice and says what happened to the file and whether the world was entered. */
async function choose(choice: TestChoice, saveWorks = true) {
  const did: string[] = [];
  const result = await testChoice(choice, {
    save: async () => {
      did.push('save');
      return saveWorks;
    },
    test: () => {
      did.push('test');
    },
  });
  return { did, result };
}

describe('the Test box (M16)', () => {
  it('opens only for unsaved changes: with nothing unsaved Test goes straight through', () => {
    expect(deployDecision([], true)).toEqual({ step: 'confirm-unsaved' });
    expect(deployDecision([], false)).toEqual({ step: 'place' });
  });

  it('says "Not saved." and offers exactly three choices, with no "don\'t ask again"', () => {
    expect(TEST_BOX.text).toBe('Not saved.');
    expect(TEST_BOX.choices.map((c) => [c.value, c.label])).toEqual([
      ['save', 'Save and test'],
      ['anyway', 'Test anyway'],
      ['cancel', 'Cancel'],
    ]);
  });

  it('Save and test saves, then tests', async () => {
    expect(await choose('save')).toEqual({ did: ['save', 'test'], result: 'tested' });
  });

  it('Save and test stays in the builder when the save did not go through (Save As called off)', async () => {
    expect(await choose('save', false)).toEqual({ did: ['save'], result: 'stayed' });
  });

  it('Test anyway tests and never touches the file', async () => {
    expect(await choose('anyway')).toEqual({ did: ['test'], result: 'tested' });
  });

  it('Cancel does neither', async () => {
    expect(await choose('cancel')).toEqual({ did: [], result: 'stayed' });
  });

  it('Enter means Test anyway and so never saves; Esc cancels; no other key chooses', async () => {
    expect(testBoxKey('Enter')).toBe('anyway');
    expect(testBoxKey('Escape')).toBe('cancel');
    for (const key of [' ', 's', 'S', 'y', 'Tab', 'ArrowLeft', 'NumpadEnter', 'Backspace']) expect(testBoxKey(key)).toBeUndefined();
    const enter = testBoxKey('Enter');
    if (enter === undefined) throw new Error('Enter chose nothing');
    expect((await choose(enter)).did).not.toContain('save');
    // Whatever key is pressed, the only way to a save is the Save and test button itself.
    for (const key of ['Enter', 'Escape', ' ', 's', 'Tab']) expect(testBoxKey(key)).not.toBe('save');
  });
});
