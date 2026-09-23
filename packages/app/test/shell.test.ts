import { describe, expect, it } from 'vitest';
import { createStore } from '../src/ui/store';
import { enterBuilder, enterWorld, toggleMode, type ModeState } from '../src/app/modes';
import { isTypingTarget } from '../src/app/keys';

describe('store', () => {
  it('merges patches and notifies subscribers until they unsubscribe', () => {
    const s = createStore({ a: 1, b: 'x' });
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set({ a: 2 });
    s.set((prev) => ({ b: `${prev.b}y` }));
    expect(s.get()).toEqual({ a: 2, b: 'xy' });
    off();
    s.set({ a: 3 });
    expect(calls).toBe(2);
  });
});

describe('modes', () => {
  const start: ModeState = { mode: 'world', paused: false, pausedBeforeBuilder: false };

  it('entering the builder pauses the world and leaving restores it', () => {
    const b = enterBuilder(start);
    expect(b).toEqual({ mode: 'builder', paused: true, pausedBeforeBuilder: false });
    expect(enterWorld(b)).toEqual({ mode: 'world', paused: false, pausedBeforeBuilder: false });
  });

  it('a world that was paused stays paused after a trip to the builder', () => {
    expect(toggleMode(toggleMode({ ...start, paused: true }))).toEqual({ mode: 'world', paused: true, pausedBeforeBuilder: true });
  });

  it('entering a mode you are already in changes nothing', () => {
    const b = enterBuilder(start);
    expect(enterBuilder(b)).toBe(b);
    expect(enterWorld(start)).toBe(start);
  });
});

describe('isTypingTarget', () => {
  it('is true for text fields and editable elements only', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
