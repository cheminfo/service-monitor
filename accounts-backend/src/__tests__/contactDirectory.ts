import { DatabaseSync } from 'node:sqlite';

import type { AccountRole } from '../rules.ts';
import type { AccountDirectory } from '../store/AccountDirectory.ts';
import type {
  AccountInsert,
  AccountRow,
  EnvAdminWrite,
} from '../store/accountRows.ts';

/** The roles of the host, by the role of the accounts each stands for. */
const HOST_ROLES = { read: 'guest', write: 'user', admin: 'admin' } as const;

/** A role of the host. */
type HostRole = (typeof HOST_ROLES)[AccountRole];

/** The role of the accounts a role of the host stands for. */
const ACCOUNT_ROLES: Record<HostRole, AccountRole> = {
  guest: 'read',
  user: 'write',
  admin: 'admin',
};

/** Whether the row being changed may stop being an administrator. */
const NOT_THE_LAST_ADMIN =
  "(role != 'admin' OR (SELECT COUNT(*) FROM contacts WHERE role = 'admin') > 1)";

const COLUMNS = `id, mail, password_hash AS passwordHash, role,
  env_admin AS envAdmin, created_at AS createdAt,
  password_set_at AS passwordSetAt, last_login_at AS lastLoginAt`;

/** A contact as the host's table holds it. */
interface ContactRow {
  id: number;
  mail: string;
  passwordHash: string;
  role: HostRole;
  envAdmin: number;
  createdAt: number;
  passwordSetAt: number;
  lastLoginAt: number | null;
}

/**
 * A host's own people, in a `contacts` table with its own column names and
 * its own roles (`guest`, `user`, `admin`), behind the `AccountDirectory` the
 * package reads: what a site that already keeps its users implements.
 * @returns the directory, on a fresh in-memory database
 */
export function contactDirectory(): AccountDirectory {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mail            TEXT    NOT NULL UNIQUE,
    password_hash   TEXT    NOT NULL,
    role            TEXT    NOT NULL CHECK (role IN ('guest', 'user', 'admin')),
    env_admin       INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    password_set_at INTEGER NOT NULL,
    last_login_at   INTEGER
  )`);
  const statements = {
    byId: db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE id = ?`),
    byMail: db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE mail = ?`),
    all: db.prepare(`SELECT ${COLUMNS} FROM contacts ORDER BY mail`),
    count: db.prepare('SELECT COUNT(*) AS count FROM contacts'),
    insert: db.prepare(
      `INSERT INTO contacts (mail, password_hash, role, created_at, password_set_at)
       VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id`,
    ),
    setPassword: db.prepare(
      `UPDATE contacts SET password_hash = ?, password_set_at = ?
       WHERE id = ? AND env_admin = 0`,
    ),
    setRole: db.prepare(
      `UPDATE contacts SET role = ?1
       WHERE id = ?2 AND env_admin = 0 AND (?1 = 'admin' OR ${NOT_THE_LAST_ADMIN})`,
    ),
    touch: db.prepare('UPDATE contacts SET last_login_at = ? WHERE id = ?'),
    remove: db.prepare(
      `DELETE FROM contacts WHERE id = ? AND env_admin = 0 AND ${NOT_THE_LAST_ADMIN}`,
    ),
    upsertEnvAdmin: db.prepare(
      `INSERT INTO contacts (mail, password_hash, role, env_admin, created_at, password_set_at)
       VALUES (?1, ?2, 'admin', 1, ?3, ?3)
       ON CONFLICT (mail) DO UPDATE SET
         role = 'admin',
         env_admin = 1,
         password_hash = excluded.password_hash,
         password_set_at = CASE
           WHEN password_hash = excluded.password_hash THEN password_set_at
           ELSE excluded.password_set_at
         END
       RETURNING id`,
    ),
    forgetEnvAdminsBut: db.prepare(
      'UPDATE contacts SET env_admin = 0 WHERE env_admin = 1 AND id != ?',
    ),
  };
  return {
    byId: (id) => read(statements.byId.get(id)),
    byUsername: (username) => read(statements.byMail.get(username)),
    all: () => {
      const rows = statements.all.all() as unknown as ContactRow[];
      const accounts: AccountRow[] = [];
      for (const row of rows) accounts.push(toAccountRow(row));
      return accounts;
    },
    count: () => (statements.count.get() as { count: number }).count,
    insert: (account: AccountInsert) =>
      (
        statements.insert.get(
          account.username,
          account.passwordHash,
          HOST_ROLES[account.role],
          account.createdAt,
        ) as { id: number }
      ).id,
    setPassword: (id, passwordHash, changedAt) =>
      Number(statements.setPassword.run(passwordHash, changedAt, id).changes) >
      0,
    setRole: (id, role) =>
      Number(statements.setRole.run(HOST_ROLES[role], id).changes) > 0,
    touchSignIn: (id, at) => {
      statements.touch.run(at, id);
    },
    removeUnlessLastAdmin: (id) =>
      Number(statements.remove.run(id).changes) > 0,
    writeEnvAdmin: (admin: EnvAdminWrite) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const { id } = statements.upsertEnvAdmin.get(
          admin.username,
          admin.passwordHash,
          admin.at,
        ) as { id: number };
        statements.forgetEnvAdminsBut.run(id);
        db.exec('COMMIT');
        return id;
      } catch (error: unknown) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    forgetEnvAdmins: () => Number(statements.forgetEnvAdminsBut.run(0).changes),
  };
}

/**
 * A row the table answered, as the package reads an account.
 * @param row - the contact, if any
 * @returns the account, or undefined
 */
function read(row: unknown): AccountRow | undefined {
  return row === undefined ? undefined : toAccountRow(row as ContactRow);
}

/**
 * A contact, as the package reads an account.
 * @param row - the contact
 * @returns the account
 */
function toAccountRow(row: ContactRow): AccountRow {
  return {
    id: row.id,
    username: row.mail,
    passwordHash: row.passwordHash,
    role: ACCOUNT_ROLES[row.role],
    envManaged: row.envAdmin === 1,
    createdAt: row.createdAt,
    passwordChangedAt: row.passwordSetAt,
    lastSignInAt: row.lastLoginAt,
  };
}
