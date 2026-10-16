import { describe, expect, it } from 'vitest';
import { codeOf, WORLD_KEYS, worldKeyAction, worldKeyCap, worldKeyLabel } from '../src/app/keys';
import { clockText, speedText } from '../src/app/Hud';
import { WORLD_KEY_CODES } from '@robots/sim-core';

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

  it('sim-core knows exactly the keys the app keeps for itself (the validator refuses them)', () => {
    const app = [...Object.keys(WORLD_KEYS), 'Tab', 'Escape'].sort();
    expect([...WORLD_KEY_CODES].sort()).toEqual(app);
    for (const code of app) expect(worldKeyLabel(code)).toBeDefined();
  });
});

describe('the world bar', () => {
  it('reads each key cap from the world key table', () => {
    expect(worldKeyCap('togglePause')).toBe('Space');
    expect(worldKeyCap('step')).toBe('.');
    expect(worldKeyCap('slower')).toBe('[');
    expect(worldKeyCap('faster')).toBe(']');
    expect(worldKeyCap('toggleDebug')).toBe('\\');
    expect(worldKeyCap('toggleGrid')).toBe('`');
    expect(worldKeyCap('camera')).toBe(',');
    // Every world key has a cap to show, not a raw code.
    for (const k of Object.values(WORLD_KEYS)) expect(worldKeyCap(k.action)).not.toMatch(/^(Key|Digit|Bracket|Back|Period|Comma)/);
  });

  it('says the clock in minutes, seconds and tenths, and each speed as the time panel does', () => {
    expect(clockText(4.2)).toBe('0:04.2');
    expect(clockText(75.04)).toBe('1:15.0');
    expect(clockText(59.96)).toBe('1:00.0');
    expect(clockText(0)).toBe('0:00.0');
    expect([0.25, 0.5, 1, 2, 4].map(speedText)).toEqual(['x1/4', 'x1/2', 'x1', 'x2', 'x4']);
  });
});
