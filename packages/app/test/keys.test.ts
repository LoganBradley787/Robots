import { describe, expect, it } from 'vitest';
import { codeOf, WORLD_KEYS, worldKeyAction, worldKeyLabel } from '../src/app/keys';

describe('codeOf', () => {
  it('prefers the physical code', () => {
    expect(codeOf({ code: 'KeyD', key: 'x' })).toBe('KeyD');
  });

  it('falls back to the key when code is empty', () => {
    expect(codeOf({ code: '', key: '.' })).toBe('Period');
    expect(codeOf({ code: '', key: ' ' })).toBe('Space');
    expect(codeOf({ code: '', key: 'd' })).toBe('KeyD');
    expect(codeOf({ code: '', key: 'Shift' })).toBe('');
  });
});

describe('world keys', () => {
  it('no letter or digit is a world key: those belong to the robot', () => {
    for (const code of Object.keys(WORLD_KEYS)) {
      expect(code).not.toMatch(/^(Key[A-Z]|Digit[0-9])$/);
    }
    expect(worldKeyAction('KeyD')).toBeUndefined();
    expect(worldKeyAction('KeyA')).toBeUndefined();
  });

  it('maps punctuation to world actions', () => {
    expect(worldKeyAction('Backslash')).toBe('toggleDebug');
    expect(worldKeyAction('Backquote')).toBe('toggleGrid');
    expect(worldKeyAction('Comma')).toBe('camera');
    expect(worldKeyAction('Space')).toBe('togglePause');
    expect(worldKeyAction('Period')).toBe('step');
  });

  it('labels world keys for the builder warning', () => {
    expect(worldKeyLabel('Space')).toBe('Space pauses the world');
    expect(worldKeyLabel('KeyD')).toBeUndefined();
  });

  it('codeOf falls back for the new punctuation keys', () => {
    expect(codeOf({ code: '', key: '\\' })).toBe('Backslash');
    expect(codeOf({ code: '', key: '`' })).toBe('Backquote');
    expect(codeOf({ code: '', key: ',' })).toBe('Comma');
  });
});
