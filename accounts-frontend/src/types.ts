// The HTTP contract between service-accounts-backend and
// service-accounts-frontend: the same file in both packages, kept identical by
// a test of the frontend. Change both in the same commit.

/** Where a browser stands: what `/session`, `/login` and `/logout` answer. */
export interface AccountSession {
  /** Whether this browser holds a live session. */
  signedIn: boolean;
  /** The account signed in, else null. */
  username: string | null;
}

/** An account, as the routes list it: never its password hash. */
export interface Account {
  id: number;
  /** What it signs in with, in lower case. */
  username: string;
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

/** What `POST /users` takes. */
export interface NewAccountBody {
  /** Letters, digits, dots, dashes and underscores; stored in lower case. */
  username: string;
  password: string;
}

/** What `PATCH /users/:id` takes: another account's new password. */
export interface SetPasswordBody {
  password: string;
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
  message: string;
}
