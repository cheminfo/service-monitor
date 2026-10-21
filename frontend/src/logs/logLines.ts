import type { LogEntry } from '../types.ts';

const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * The lines on show, with those written since put in front, the newest
 * first. A line already on show is not shown twice.
 * @param current - the lines on show, the newest first
 * @param newer - the lines written since, the oldest first
 * @returns every line, the newest first
 */
export function withNewer(
  current: readonly LogEntry[],
  newer: readonly LogEntry[],
): LogEntry[] {
  const newest = current[0]?.id ?? 0;
  const lines: LogEntry[] = [];
  for (let index = newer.length - 1; index >= 0; index--) {
    const line = newer[index];
    if (line !== undefined && line.id > newest) lines.push(line);
  }
  return lines.concat(current);
}

/**
 * When a line was written, as short as reads clearly: the time alone on the
 * day it is read, the day too before that.
 * @param at - when, in unix milliseconds
 * @param now - the current instant, in unix milliseconds
 * @returns e.g. `14:03:07`, or `20 Oct, 14:03:07`
 */
export function formatLogTime(at: number, now: number): string {
  const isSameDay =
    new Date(at).toDateString() === new Date(now).toDateString();
  return (isSameDay ? TIME : DATE_TIME).format(at);
}

/**
 * A set with one value added, or removed when it was there.
 * @param set - the set
 * @param value - the value
 * @returns a new set
 */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
