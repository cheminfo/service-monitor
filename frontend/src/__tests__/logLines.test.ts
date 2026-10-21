import { expect, test } from 'vitest';

import { formatLogTime, toggled, withNewer } from '../logs/logLines.ts';
import type { LogEntry } from '../types.ts';

/**
 * A line with an id.
 * @param id - its id
 * @returns the line
 */
function line(id: number): LogEntry {
  return {
    id,
    at: id,
    level: 30,
    levelLabel: 'info',
    topic: 'main',
    role: 'server',
    pid: 7,
    hostname: 'host',
    message: `line ${id}`,
    meta: null,
  };
}

test('the lines written since go in front, the newest first, never twice', () => {
  const lines = withNewer([line(3), line(2)], [line(3), line(4), line(5)]);

  expect(lines.map((entry) => entry.id)).toStrictEqual([5, 4, 3, 2]);
});

test('a line of today shows its time, an older one its day too', () => {
  const now = Date.UTC(2026, 9, 21, 12);
  const sameDay = new Date(now);
  sameDay.setHours(8, 5, 9, 0);
  const dayBefore = new Date(now);
  dayBefore.setDate(dayBefore.getDate() - 1);
  dayBefore.setHours(23, 0, 0, 0);

  expect(formatLogTime(sameDay.getTime(), now)).toBe('08:05:09');
  expect(formatLogTime(dayBefore.getTime(), now)).toBe(
    `${dayBefore.getDate()} Oct, 23:00:00`,
  );
});

test('a value is added to a set, or removed when it was there', () => {
  expect([...toggled(new Set([1, 2]), 2)]).toStrictEqual([1]);
  expect([...toggled(new Set([1]), 3)]).toStrictEqual([1, 3]);
});
