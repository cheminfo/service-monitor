import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import Postgrator from 'postgrator';

/**
 * Beside the compiled files as beside the sources: `lib/store` and `src/store`
 * are siblings, and both read the migrations from `src`.
 */
const MIGRATIONS = join(import.meta.dirname, '../../src/store/migrations');

/**
 * The table the store records its migrations in. A name of its own, so the
 * host may keep tables of its own in the same file, migrated by a Postgrator
 * of its own under the default `schemaversion`.
 */
export const SCHEMA_TABLE = 'service_monitor_version';

/**
 * How long a migration waits for another connection's write to end.
 */
const LOCK_WAIT_MS = 30_000;

/**
 * Bring the store's tables to the latest schema, running every migration they
 * lack, in one transaction: several processes opening the file at once wait
 * for one another rather than each running the migrations.
 *
 * A file already up to date takes no lock at all. Otherwise the lock is
 * awaited rather than waited for: Postgrator reads its files between
 * statements, and a connection of this same process blocking the event loop
 * on the lock would keep the one holding it from ever finishing.
 * @param database - the connection to migrate
 * @throws {Error} When a migration fails, which leaves the file as it was.
 */
export async function migrate(database: DatabaseSync): Promise<void> {
  if (currentVersion(database) >= latestVersion()) return;
  await beginImmediate(database);
  try {
    const postgrator = new Postgrator({
      migrationPattern: join(MIGRATIONS, '*'),
      driver: 'sqlite3',
      schemaTable: SCHEMA_TABLE,
      execQuery: (query: string) =>
        Promise.resolve({ rows: database.prepare(query).all() }),
      execSqlScript: (script: string) => {
        database.exec(script);
        return Promise.resolve();
      },
    });
    await postgrator.migrate();
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/**
 * The version the file's tables are at.
 * @param database - the connection
 * @returns it, 0 before the first migration
 */
function currentVersion(database: DatabaseSync): number {
  try {
    const row = database
      .prepare(`SELECT max(version) AS version FROM ${SCHEMA_TABLE}`)
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The version the last migration brings the tables to.
 * @returns its number
 */
function latestVersion(): number {
  let latest = 0;
  for (const name of readdirSync(MIGRATIONS)) {
    const version = Math.trunc(Number(name.split('.', 1)[0]));
    if (name.includes('.do.') && version > latest) latest = version;
  }
  return latest;
}

/**
 * Begin a write transaction, retrying while another connection writes,
 * without blocking the event loop.
 * @param database - the connection
 */
async function beginImmediate(database: DatabaseSync): Promise<void> {
  const { timeout } = database.prepare('PRAGMA busy_timeout').get() as {
    timeout: number;
  };
  database.exec('PRAGMA busy_timeout = 0');
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        database.exec('BEGIN IMMEDIATE');
        return;
      } catch (error: unknown) {
        if (!isBusy(error) || Date.now() > deadline) throw error;
      }
      // eslint-disable-next-line no-await-in-loop -- waiting for the other writer is the point
      await delay(20);
    }
  } finally {
    database.exec(`PRAGMA busy_timeout = ${timeout}`);
  }
}

/**
 * Whether SQLite refused because another connection holds the lock.
 * @param error - what was thrown
 * @returns whether it did
 */
function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return code === 5 || code === 6;
}
