import type { DatabaseSync } from 'node:sqlite';

import { levelLabelOf } from '../levels.ts';
import type { Activity, LogEntry, ProcessView } from '../types.ts';

import type { ProcessRow, StoredLogRow } from './statements.ts';

/**
 * The pragmas of an on-disk store. Every process writes to it, so a write
 * waits for another rather than failing; but never for long, since a logger
 * waits with it.
 * @param database - the connection
 */
export function applyPragmas(database: DatabaseSync): void {
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA journal_mode = WAL');
  // Lines can be lost on an OS crash, which costs nothing anyone relies on.
  database.exec('PRAGMA synchronous = OFF');
  database.exec('PRAGMA temp_store = MEMORY');
}

/**
 * A line as the routes answer it.
 * @param row - the row
 * @returns the line
 */
export function entryOf(row: StoredLogRow): LogEntry {
  return {
    id: row.id,
    at: row.at,
    level: row.level,
    levelLabel: levelLabelOf(row.level),
    topic: row.topic,
    role: row.role,
    pid: row.pid,
    hostname: row.hostname,
    message: row.message,
    meta:
      row.meta === null ? null : (parseObject(row.meta) ?? { raw: row.meta }),
  };
}

/**
 * A JSON object.
 * @param text - its text
 * @returns it, or undefined when the text holds no object
 */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A process as a reader sees it.
 * @param row - its row
 * @param now - the current instant, in unix milliseconds
 * @returns the process, stale once it missed three beats
 */
export function processOf(row: ProcessRow, now: number): ProcessView {
  return {
    role: row.role,
    pid: row.pid,
    hostname: row.hostname,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    intervalMs: row.intervalMs,
    memory: { rss: row.rss, heapUsed: row.heapUsed, heapTotal: row.heapTotal },
    cpuPercent: row.cpuPercent,
    eventLoopDelayMs: row.eventLoopDelayMs,
    activity: (parseObject(row.activity) ?? {}) as Activity,
    stale: now - row.updatedAt > 3 * row.intervalMs,
  };
}
