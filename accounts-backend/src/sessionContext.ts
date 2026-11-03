import type { VerifyLegacyHash } from './password.ts';
import type { VerifyToken } from './serviceAccountsTypes.ts';
import type { Sessions } from './sessions.ts';
import type { AccountDirectory } from './store/AccountDirectory.ts';
import type { AccountRow } from './store/accountRows.ts';

/**
 * What the guard and the session routes share, whether the accounts are kept
 * in a directory or are one shared password.
 */
export interface SessionContext {
  /** The account a session names, read again at every request. */
  findAccount: (id: number) => Promise<AccountRow | undefined>;
  /** What opens and checks sessions. */
  sessions: Sessions;
  /** The cookie a session is kept in. */
  cookieName: string;
  /** The operator's token, or undefined when none is taken. */
  adminToken: string | undefined;
  /** The account an API token stands for, or undefined when none is taken. */
  verifyToken: VerifyToken | undefined;
  /** Whether a token is also read from `?token=`. */
  tokenQueryParameter: boolean;
}

/** What the guard and the routes of the accounts share. */
export interface AccountsContext extends SessionContext {
  /** The accounts. */
  store: () => Promise<AccountDirectory>;
  /** Checks a password against a hash of the host's former format, if any. */
  verifyLegacyHash: VerifyLegacyHash | undefined;
}
