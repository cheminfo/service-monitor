import type { DatabaseSync } from 'node:sqlite';

import type { LogFacet } from '../types.ts';

import { TypedStatement } from './TypedStatement.ts';

/**
 * A line as the store keeps it.
 */
export interface LogRow {
  at: number;
  level: number;
  topic: string;
  role: string;
  pid: number;
  hostname: string;
  message: string;
  /**
   * The other fields, as JSON; null when there are none.
   */
  meta: string | null;
}

/**
 * A line as the store reads it back.
 */
export type StoredLogRow = LogRow & { id: number };

/**
 * A row of `processes`.
 */
export interface ProcessRow {
  hostname: string;
  pid: number;
  role: string;
  startedAt: number;
  updatedAt: number;
  intervalMs: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  cpuPercent: number;
  eventLoopDelayMs: number;
  /**
   * A JSON object.
   */
  activity: string;
}

/**
 * The columns a line is read with.
 */
export const LOG_COLUMNS =
  'id, at, level, topic, role, pid, hostname, message, meta';

/**
 * The statements of the store, prepared once.
 * @param database - its connection
 * @returns them, by what they do
 */
export function prepareStatements(database: DatabaseSync) {
  const prepare = <T extends object>(sql: string) =>
    new TypedStatement<T>(database.prepare(sql));
  return {
    insertLog: prepare<never>(
      `INSERT INTO logs (at, level, topic, role, pid, hostname, message, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    touchTopic: prepare<never>(
      `INSERT INTO log_topics (name, lastAt) VALUES (?, ?)
       ON CONFLICT (name) DO UPDATE SET lastAt = max(lastAt, excluded.lastAt)`,
    ),
    touchRole: prepare<never>(
      `INSERT INTO log_roles (name, lastAt) VALUES (?, ?)
       ON CONFLICT (name) DO UPDATE SET lastAt = max(lastAt, excluded.lastAt)`,
    ),
    topics: prepare<LogFacet>(
      'SELECT name, lastAt FROM log_topics ORDER BY name',
    ),
    roles: prepare<LogFacet>(
      'SELECT name, lastAt FROM log_roles ORDER BY name',
    ),
    maxId: prepare<{ id: number | null }>('SELECT max(id) AS id FROM logs'),
    minId: prepare<{ id: number | null }>('SELECT min(id) AS id FROM logs'),
    // The rows are in the order they were written, so the first one recent
    // enough is found by reading from the oldest, which retention deletes.
    firstSince: prepare<{ id: number }>(
      'SELECT id FROM logs WHERE at >= ? ORDER BY id LIMIT 1',
    ),
    deleteRoutine: prepare<never>(
      `DELETE FROM logs WHERE id IN (
         SELECT id FROM logs WHERE level < ? AND id < ? LIMIT ?)`,
    ),
    deleteProblems: prepare<never>(
      `DELETE FROM logs WHERE id IN (
         SELECT id FROM logs INDEXED BY logs_problems
         WHERE level >= 40 AND at < ? LIMIT ?)`,
    ),
    forgetTopics: prepare<never>('DELETE FROM log_topics WHERE lastAt < ?'),
    forgetRoles: prepare<never>('DELETE FROM log_roles WHERE lastAt < ?'),
    writeProcess: prepare<never>(
      `INSERT INTO processes (hostname, pid, role, startedAt, updatedAt,
         intervalMs, rss, heapUsed, heapTotal, cpuPercent, eventLoopDelayMs,
         activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (hostname, pid) DO UPDATE SET
         role = excluded.role, startedAt = excluded.startedAt,
         updatedAt = excluded.updatedAt, intervalMs = excluded.intervalMs,
         rss = excluded.rss, heapUsed = excluded.heapUsed,
         heapTotal = excluded.heapTotal, cpuPercent = excluded.cpuPercent,
         eventLoopDelayMs = excluded.eventLoopDelayMs,
         activity = excluded.activity`,
    ),
    removeProcess: prepare<never>(
      'DELETE FROM processes WHERE hostname = ? AND pid = ?',
    ),
    processes: prepare<ProcessRow>(
      `SELECT hostname, pid, role, startedAt, updatedAt, intervalMs, rss,
         heapUsed, heapTotal, cpuPercent, eventLoopDelayMs, activity
       FROM processes WHERE updatedAt >= ? ORDER BY role, startedAt`,
    ),
    forgetProcesses: prepare<never>(
      'DELETE FROM processes WHERE updatedAt < ?',
    ),
  };
}

/**
 * The statements of a store.
 */
export type Statements = ReturnType<typeof prepareStatements>;
