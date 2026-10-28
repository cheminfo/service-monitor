// The HTTP contract between service-accounts-backend and
// service-accounts-frontend: the same file in both packages, kept identical by
// a test of the frontend. Change both in the same commit.

import type { AccountRefusal, AccountRole } from './rules.ts';

/** Where a browser stands: what `/session`, `/login` and `/logout` answer. */
export interface AccountSession {
  /** Whether this browser holds a live session. */
  signedIn: boolean;
  /** The account signed in, else null; always null for a shared password. */
  username: string | null;
  /** What the account signed in may do, else null. */
  role: AccountRole | null;
}

/** An account, as the routes list it: never its password hash. */
export interface Account {
  id: number;
  /** What it signs in with, in lower case. */
  username: string;
  /** What it may do. */
  role: AccountRole;
  /**
   * Whether ADMIN_USERNAME and ADMIN_PASSWORD of the server's `.env` define
   * it: it is then changed there, never through the routes.
   */
  envManaged: boolean;
  /** When it was added, in unix seconds. */
  createdAt: number;
  /** When its password last changed, in unix seconds. */
  passwordChangedAt: number;
  /** When it last signed in, in unix seconds, or null when never. */
  lastSignInAt: number | null;
}

/** What `GET /users` answers. */
export interface AccountsResponse {
  /** Every account, by username. */
  users: Account[];
}

/** What `POST /login` takes. */
export interface SignInBody {
  username: string;
  password: string;
}

/** What `POST /login` takes when the site signs in with a shared password. */
export interface PasswordSignInBody {
  password: string;
}

/** What `POST /users` takes. */
export interface NewAccountBody {
  /** Letters, digits, dots, dashes and underscores; stored in lower case. */
  username: string;
  password: string;
  /**
   * What it may do.
   * @default 'read'
   */
  role?: AccountRole;
}

/**
 * What `PATCH /users/:id` takes: another account's new password, its new
 * role, or both.
 */
export interface AccountPatchBody {
  /**
   * Its new password, which signs it out everywhere.
   * @default undefined — the password is kept
   */
  password?: string;
  /**
   * Its new role, which applies at its next request.
   * @default undefined — the role is kept
   */
  role?: AccountRole;
}

/** What `POST /password` takes: the account signed in changes its own. */
export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

/** What every refusal answers. */
export interface AccountsError {
  statusCode: number;
  error: string;
  /** Why, in English: what a script and a log read. */
  message: string;
  /**
   * Why, as a code a page writes in its own language. Fastify's own refusals
   * (a body that does not validate, a server error) carry a `FST_` code of
   * theirs, or none.
   * @default undefined
   */
  code?: AccountRefusal | (string & Record<never, never>);
}
