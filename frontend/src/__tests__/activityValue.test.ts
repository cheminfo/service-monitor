import { expect, test, vi } from 'vitest';

import { activityValue } from '../activityValue.ts';

test('a figure is written by what its name says it is', () => {
  expect([
    activityValue('phase', 'parsing'),
    activityValue('done', false),
    activityValue('entries', 1_204_000),
    activityValue('elapsedMs', 90_000),
  ]).toStrictEqual(['parsing', 'false', '1,204,000', '1m 30s']);
});

test('a figure with no value is a dash, not the word null', () => {
  expect(activityValue('importing', null)).toBe('—');
});

test('an instant is written as how long ago it was', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 21, 12));

  try {
    expect(activityValue('lastBatchAt', Date.UTC(2026, 9, 21, 11, 45))).toBe(
      '15 minutes ago',
    );
  } finally {
    vi.useRealTimers();
  }
});
