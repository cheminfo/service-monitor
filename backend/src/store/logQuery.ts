import type { SQLInputValue } from 'node:sqlite';

import { LEVEL_VALUES } from '../levels.ts';
import type { LogLevel } from '../types.ts';

import { LOG_COLUMNS } from './statements.ts';

/**
 * Which lines to read.
 */
export interface LogQuery {
  /**
   * The least severe level read.
   * @default 'trace' — every line
   */
  minLevel?: LogLevel;
  /**
   * Only the lines of these topics.
   * @default [] — every topic
   */
  topics?: readonly string[];
  /**
   * Only the lines of the processes with these roles.
   * @default [] — every process
   */
  roles?: readonly string[];
  /**
   * Text the message must hold; ASCII letters match either case.
   * @default undefined — any message
   */
  text?: string;
  /**
   * Only the lines older than this id: the next page of a reading.
   * @default undefined — from the newest
   */
  before?: number;
  /**
   * Only the lines newer than this id, the oldest first: what was written
   * since a reader last looked.
   * @default undefined
   */
  after?: number;
  /**
   * The most lines answered.
   * @default 200
   */
  limit?: number;
}

/**
 * A statement and its parameters.
 */
export interface BuiltQuery {
  sql: string;
  params: SQLInputValue[];
}

/**
 * The most lines one page may hold.
 */
export const MAX_LIMIT = 1000;

/**
 * The statement that reads a page of lines: one more than the limit, so the
 * caller can tell whether another page follows.
 * @param query - which lines
 * @param scanFloor - for a text search, the id at or below which no line is
 *   read; undefined for any other query
 * @returns the statement
 */
export function buildLogQuery(
  query: LogQuery,
  scanFloor: number | undefined,
): BuiltQuery {
  const {
    minLevel = 'trace',
    topics = [],
    roles = [],
    before,
    after,
    text,
  } = query;
  const limit = clampLimit(query.limit);
  const where: string[] = [];
  const parameters: SQLInputValue[] = [];

  const from = `logs${indexFor(minLevel)}`;
  if (minLevel !== 'trace') {
    where.push(`${problemFloor(minLevel)}level >= ?`);
    parameters.push(LEVEL_VALUES[minLevel]);
  }
  if (topics.length > 0) {
    where.push(`topic IN (${placeholders(topics.length)})`);
    parameters.push(...topics);
  }
  if (roles.length > 0) {
    where.push(`role IN (${placeholders(roles.length)})`);
    parameters.push(...roles);
  }
  if (before !== undefined) {
    where.push('id < ?');
    parameters.push(before);
  }
  if (after !== undefined) {
    where.push('id > ?');
    parameters.push(after);
  }
  if (text && scanFloor !== undefined) {
    where.push('id > ?', String.raw`message LIKE ? ESCAPE '\'`);
    parameters.push(scanFloor, `%${escapeLike(text)}%`);
  }

  const order = after === undefined ? 'DESC' : 'ASC';
  const filter = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
  return {
    sql: `SELECT ${LOG_COLUMNS} FROM ${from} ${filter} ORDER BY id ${order} LIMIT ?`,
    params: [...parameters, limit + 1],
  };
}

/**
 * The partial index that holds only the lines at a level or worse, when one
 * does: a read of the warnings or the errors then walks those alone, which
 * SQLite cannot tell is cheaper from the level's bounds.
 * @param minLevel - the least severe level read
 * @returns the `INDEXED BY` clause, or nothing
 */
export function indexFor(minLevel: LogLevel): string {
  const value = LEVEL_VALUES[minLevel];
  if (value >= LEVEL_VALUES.error) return ' INDEXED BY logs_errors';
  if (value >= LEVEL_VALUES.warn) return ' INDEXED BY logs_problems';
  return '';
}

/**
 * The condition, in the words of the partial index's own, that lets SQLite
 * use it.
 * @param minLevel - the least severe level read
 * @returns the condition and an `AND`, or nothing
 */
export function problemFloor(minLevel: LogLevel): string {
  const value = LEVEL_VALUES[minLevel];
  if (value >= LEVEL_VALUES.error) return 'level >= 50 AND ';
  if (value >= LEVEL_VALUES.warn) return 'level >= 40 AND ';
  return '';
}

/**
 * The number of lines a page holds.
 * @param limit - what was asked
 * @returns it, between 1 and the most a page may hold; 200 when not given
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 200;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Text matched literally by LIKE: its wildcards and the escape escaped.
 * @param text - the text
 * @returns it, escaped with a backslash
 */
export function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, String.raw`\$&`);
}

/**
 * Placeholders for a list of parameters.
 * @param count - how many
 * @returns `?, ?, ?`
 */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
