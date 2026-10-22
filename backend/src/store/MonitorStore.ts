import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { LEVEL_VALUES } from '../levels.ts';
import type {
  LogFacetsResponse,
  LogLevel,
  LogsResponse,
  ProcessStatus,
  ProcessView,
} from '../types.ts';

import { TypedStatement } from './TypedStatement.ts';
import type { LogQuery } from './logQuery.ts';
import {
  buildLogQuery,
  clampLimit,
  indexFor,
  problemFloor,
} from './logQuery.ts';
import { migrate } from './migrate.ts';
import type { LogRetention } from './retention.ts';
import { FORGOTTEN_AFTER, pruneLogs } from './retention.ts';
import { applyPragmas, entryOf, processOf } from './rows.ts';
import type { LogRow, Statements, StoredLogRow } from './statements.ts';
import { prepareStatements } from './statements.ts';

/**
 * How the store reads.
 */
export interface MonitorStoreOptions {
  /**
   * The most recent lines a text search reads: a search costs the same
   * whatever the table holds, and says when it stopped short.
   * @default 100000
   */
  maxScanLines?: number;
}

/**
 * What every process of a service logged, and what each running process last
 * wrote about itself, in one SQLite file every process opens. Each line has a
 * level, as pino numbers them, and a topic, the name of the logger that wrote
 * it.
 *
 * The tables carry a migration record of their own, so the file may also hold
 * the host's tables, migrated by the host.
 */
export class MonitorStore {
  /**
   * Open the store, creating its directory and its tables or bringing them up
   * to date: a process may well log before the service's own database exists.
   * @param path - the file, or `:memory:` for tests
   * @param options - how it reads
   * @returns the store
   */
  static async open(
    path: string,
    options: MonitorStoreOptions = {},
  ): Promise<MonitorStore> {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    try {
      if (path !== ':memory:') applyPragmas(database);
      await migrate(database);
    } catch (error: unknown) {
      database.close();
      throw error;
    }
    return new MonitorStore(database, options);
  }

  readonly #db: DatabaseSync;
  readonly #statements: Statements;
  readonly #maxScanLines: number;

  private constructor(database: DatabaseSync, options: MonitorStoreOptions) {
    this.#db = database;
    this.#statements = prepareStatements(database);
    this.#maxScanLines = options.maxScanLines ?? 100_000;
  }

  /**
   * Keep lines, in one transaction.
   * @param rows - the lines, in the order they were written
   */
  insertLogs(rows: readonly LogRow[]): void {
    if (rows.length === 0) return;
    const statements = this.#statements;
    const topics = new Map<string, number>();
    const roles = new Map<string, number>();
    this.#db.exec('BEGIN');
    try {
      for (const row of rows) {
        statements.insertLog.run(
          row.at,
          row.level,
          row.topic,
          row.role,
          row.pid,
          row.hostname,
          row.message,
          row.meta,
        );
        topics.set(row.topic, Math.max(row.at, topics.get(row.topic) ?? 0));
        roles.set(row.role, Math.max(row.at, roles.get(row.role) ?? 0));
      }
      for (const [name, at] of topics) statements.touchTopic.run(name, at);
      for (const [name, at] of roles) statements.touchRole.run(name, at);
      this.#db.exec('COMMIT');
    } catch (error: unknown) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * A page of lines, the newest first, or, given `after`, the lines written
   * since, the oldest first.
   * @param query - which lines
   * @returns them
   */
  queryLogs(query: LogQuery): LogsResponse {
    const limit = clampLimit(query.limit);
    let scanFloor: number | undefined;
    let isTruncated = false;
    if (query.text) {
      const maxId = this.#statements.maxId.get()?.id ?? 0;
      scanFloor = Math.max(0, maxId - this.#maxScanLines);
      const minId = this.#statements.minId.get()?.id ?? 0;
      isTruncated = scanFloor > 0 && minId <= scanFloor;
    }
    const { sql, params } = buildLogQuery({ ...query, limit }, scanFloor);
    const rows = new TypedStatement<StoredLogRow>(this.#db.prepare(sql)).all(
      ...params,
    );
    const isMore = rows.length > limit;
    if (isMore) rows.pop();
    const logs = rows.map(entryOf);
    const last = logs.at(-1);
    return {
      logs,
      nextBefore:
        isMore && query.after === undefined && last !== undefined
          ? last.id
          : null,
      truncated: isTruncated,
    };
  }

  /**
   * Every topic and role that has logged, by name.
   * @returns them, with when each last logged
   */
  logFacets(): LogFacetsResponse {
    const { topics, roles } = this.#statements;
    return {
      topics: topics.all().map(({ name, lastAt }) => ({ name, lastAt })),
      roles: roles.all().map(({ name, lastAt }) => ({ name, lastAt })),
    };
  }

  /**
   * How many lines at a level or worse were written since an instant, read
   * from the newest and counted up to a cap, so a flood costs no more than a
   * trickle.
   * @param minLevel - the least severe level counted
   * @param since - the instant, in unix milliseconds
   * @param cap - the most counted
   * @returns the count, at most `cap`
   */
  countRecentLogs(minLevel: LogLevel, since: number, cap = 1000): number {
    const rows = new TypedStatement<{ at: number }>(
      this.#db.prepare(
        `SELECT at FROM logs${indexFor(minLevel)}
         WHERE ${problemFloor(minLevel)}level >= ? ORDER BY id DESC LIMIT ?`,
      ),
    ).all(LEVEL_VALUES[minLevel], cap);
    let count = 0;
    for (const row of rows) if (row.at >= since) count++;
    return count;
  }

  /**
   * Keep what a process wrote about itself, replacing what it wrote before.
   * @param status - the status
   */
  writeProcess(status: ProcessStatus): void {
    this.#statements.writeProcess.run(
      status.hostname,
      status.pid,
      status.role,
      status.startedAt,
      status.updatedAt,
      status.intervalMs,
      status.memory.rss,
      status.memory.heapUsed,
      status.memory.heapTotal,
      status.cpuPercent,
      status.eventLoopDelayMs,
      JSON.stringify(status.activity),
    );
  }

  /**
   * Forget a process that stopped, so it is not shown as one that hangs.
   * @param hostname - where it ran
   * @param pid - its id there
   */
  removeProcess(hostname: string, pid: number): void {
    this.#statements.removeProcess.run(hostname, pid);
  }

  /**
   * Every process that wrote about itself in the last day, by role then age.
   * @param now - the current instant, in unix milliseconds
   * @returns them, each marked stale once it missed three beats
   */
  readProcesses(now: number): ProcessView[] {
    return this.#statements.processes
      .all(now - FORGOTTEN_AFTER)
      .map((row) => processOf(row, now));
  }

  /**
   * Delete the lines past their retention, and the processes long gone.
   * @param now - the current instant, in unix milliseconds
   * @param retention - how long lines are kept
   * @returns the lines deleted
   */
  prune(now: number, retention?: LogRetention): Promise<number> {
    return pruneLogs(this.#statements, now, retention);
  }

  /**
   * Close the connection.
   */
  close(): void {
    this.#db.close();
  }
}
