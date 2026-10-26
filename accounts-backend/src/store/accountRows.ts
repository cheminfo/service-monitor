import type { AccountRole } from '../rules.ts';

/** An account as the store holds it, password hash included. */
export interface AccountRow {
  id: number;
  /** What it signs in with, in lower case. */
  username: string;
  /** `pbkdf2$sha512$<iterations>$<salt>$<hash>`, never sent to a client. */
  passwordHash: string;
  /** What it may do. */
  role: AccountRole;
  /** Whether ADMIN_USERNAME and ADMIN_PASSWORD of the server's `.env` define it. */
  envManaged: boolean;
  /** When it was added, in unix seconds. */
  createdAt: number;
  /** When its password last changed, in unix seconds. */
  passwordChangedAt: number;
  /** When it last signed in, in unix seconds, or null when never. */
  lastSignInAt: number | null;
}

/** What a new account is stored with. */
export interface AccountInsert {
  /** What it signs in with, in lower case. */
  username: string;
  /** Its password's hash. */
  passwordHash: string;
  /** What it may do. */
  role: AccountRole;
  /** In unix seconds; the password is changed at the same instant. */
  createdAt: number;
}

/** The administrator the server's `.env` defines, as it is stored. */
export interface EnvAdminWrite {
  /** `ADMIN_USERNAME`, in lower case. */
  username: string;
  /**
   * The hash to keep: the stored one while `ADMIN_PASSWORD` still verifies
   * against it, so its sessions survive, else a new one.
   */
  passwordHash: string;
  /** When, in unix seconds. */
  at: number;
}

/** An account as SQLite returns it: `env_managed` is a 0 or a 1. */
export interface StoredAccountRow {
  id: number;
  username: string;
  passwordHash: string;
  role: AccountRole;
  envManaged: number;
  createdAt: number;
  passwordChangedAt: number;
  lastSignInAt: number | null;
}
