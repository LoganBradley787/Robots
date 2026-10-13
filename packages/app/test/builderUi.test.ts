import { describe, expect, it } from 'vitest';
import { statusOf } from '../src/ui/TopStrip';
import { BOARD_OFFSET, LAYOUT } from '../src/ui/layout';

describe('the top strip status pill', () => {
  it('says ready, counts warnings, and counts only problems when there are any', () => {
    expect(statusOf([])).toEqual({ text: 'ready', level: 'ok' });
    expect(statusOf([{ severity: 'warning' }])).toEqual({ text: '1 warning', level: 'warn' });
    expect(statusOf([{ severity: 'warning' }, { severity: 'warning' }])).toEqual({ text: '2 warnings', level: 'warn' });
    expect(statusOf([{ severity: 'warning' }, { severity: 'error' }])).toEqual({ text: '1 problem', level: 'err' });
    expect(statusOf([{ severity: 'error' }, { severity: 'error' }])).toEqual({ text: '2 problems', level: 'err' });
  });
});

describe('the builder layout', () => {
  it('puts the middle of the board between the panels', () => {
    // 1440 by 900: the board runs from x 236 to 1128 and y 38 to 874.
    expect(1440 / 2 + BOARD_OFFSET.x).toBe((LAYOUT.drawer + (1440 - LAYOUT.inspector)) / 2);
    expect(900 / 2 + BOARD_OFFSET.y).toBe((LAYOUT.top + (900 - LAYOUT.hint)) / 2);
  });
});
