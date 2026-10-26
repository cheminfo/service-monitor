import type { DatabaseSync } from 'node:sqlite';

import { TypedStatement } from './TypedStatement.ts';
import type { StoredAccountRow } from './accountRows.ts';

/** The columns every read takes, `env_managed` named the way the rows are. */
const COLUMNS =
  'id, username, passwordHash, role, env_managed AS envManaged, createdAt, passwordChangedAt, lastSignInAt';

/**
 * Whether the row being changed may stop being an administrator: it is none,
 * or another one is left. One statement, so two administrators demoting each
 * other at once cannot both succeed.
 */
const NOT_THE_LAST_ADMIN =
  "(role != 'admin' OR (SELECT COUNT(*) FROM accounts WHERE role = 'admin') > 1)";

/**
 * The statements of the store.
 * @param database - the connection
 * @returns them, by what they do
 */
export function prepareAccountStatements(database: DatabaseSync) {
  const prepare = <T extends object>(sql: string) =>
    new TypedStatement<T>(database.prepare(sql));
  return {
    byId: prepare<StoredAccountRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE id = ?`,
    ),
    byUsername: prepare<StoredAccountRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE username = ?`,
    ),
    all: prepare<StoredAccountRow>(
      `SELECT ${COLUMNS} FROM accounts ORDER BY username`,
    ),
    count: prepare<{ count: number }>('SELECT COUNT(*) AS count FROM accounts'),
    insert: prepare<{ id: number }>(
      `INSERT INTO accounts (username, passwordHash, createdAt, passwordChangedAt, role)
       VALUES (?1, ?2, ?3, ?3, ?4)
       RETURNING id`,
    ),
    setPassword: prepare(
      `UPDATE accounts SET passwordHash = ?, passwordChangedAt = ?
       WHERE id = ? AND env_managed = 0`,
    ),
    setRole: prepare(
      `UPDATE accounts SET role = ?1
       WHERE id = ?2 AND env_managed = 0 AND (?1 = 'admin' OR ${NOT_THE_LAST_ADMIN})`,
    ),
    touchSignIn: prepare('UPDATE accounts SET lastSignInAt = ? WHERE id = ?'),
    removeUnlessLastAdmin: prepare(
      `DELETE FROM accounts
       WHERE id = ? AND env_managed = 0 AND ${NOT_THE_LAST_ADMIN}`,
    ),
    // Every right-hand side reads the row as it was before the update, so the
    // date of the password moves only when its hash does.
    upsertEnvAdmin: prepare<{ id: number }>(
      `INSERT INTO accounts (username, passwordHash, createdAt, passwordChangedAt, role, env_managed)
       VALUES (?1, ?2, ?3, ?3, 'admin', 1)
       ON CONFLICT (username) DO UPDATE SET
         role = 'admin',
         env_managed = 1,
         passwordHash = excluded.passwordHash,
         passwordChangedAt = CASE
           WHEN passwordHash = excluded.passwordHash THEN passwordChangedAt
           ELSE excluded.passwordChangedAt
         END
       RETURNING id`,
    ),
    forgetEnvAdminsBut: prepare(
      'UPDATE accounts SET env_managed = 0 WHERE env_managed = 1 AND id != ?',
    ),
  };
}
