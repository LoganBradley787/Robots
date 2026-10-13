import { describe, expect, it } from 'vitest';
import { codeOf, WORLD_KEYS, worldKeyAction, worldKeyCap, worldKeyLabel } from '../src/app/keys';
import { statusLine } from '../src/app/Hud';
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

  it('says the time, the speed and who the camera is on, in one line', () => {
    expect(statusLine(4.2, 1, false, 'controlling Car')).toBe('0:04.2   x1   controlling Car');
    expect(statusLine(75.04, 0.5, true, 'watching enemy Drone')).toBe('1:15.0   x0.5   paused   watching enemy Drone');
    expect(statusLine(0, 2, false, 'no robots yet: build one and press Test')).toBe('0:00.0   x2   no robots yet: build one and press Test');
  });
});
