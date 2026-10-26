// What the routes of service-accounts-backend accept and refuse, checked the
// same way on both sides: the roles, the refusals and their English, and the
// rules a username and a password keep. The same file in both packages, kept
// identical by a test of the frontend. Change both in the same commit.

/**
 * What an account may do, from the least to the most: `read` reads, `write`
 * reads and writes, and `admin` also manages the accounts.
 */
export const ACCOUNT_ROLES = ['read', 'write', 'admin'] as const;

/** One of {@link ACCOUNT_ROLES}. */
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** The role an account is added with when none is named: it only reads. */
export const DEFAULT_ACCOUNT_ROLE: AccountRole = 'read';

/**
 * Every reason the routes refuse a request, as the `code` of the refusal. A
 * page writes it in its own language: react-cheminfo's chrome catalog holds
 * the sentence of each under `account.refusal.<code>`.
 */
export const ACCOUNT_REFUSALS = [
  'wrongCredentials',
  'tooManyAttempts',
  'signInElsewhere',
  'signOutElsewhere',
  'changeElsewhere',
  'signInRequired',
  'sessionEnded',
  'wrongToken',
  'noAdminToken',
  'roleTooLow',
  'usernameLength',
  'usernameCharacters',
  'usernameTaken',
  'passwordEmpty',
  'passwordTooLong',
  'noSuchAccount',
  'nothingToChange',
  'useChangePassword',
  'ownRole',
  'removeYourself',
  'lastAdmin',
  'envManaged',
  'tokenCannotChangePassword',
  'wrongCurrentPassword',
  'accountRemoved',
] as const;

/** One of {@link ACCOUNT_REFUSALS}. */
export type AccountRefusal = (typeof ACCOUNT_REFUSALS)[number];

/** Why a username or a password cannot be used. */
export type AccountProblem = Extract<
  AccountRefusal,
  'usernameLength' | 'usernameCharacters' | 'passwordEmpty' | 'passwordTooLong'
>;

/** The shortest username. */
export const MIN_USERNAME_LENGTH = 3;

/** The longest username, so it stays readable in the list of accounts. */
export const MAX_USERNAME_LENGTH = 30;

/** The longest password: PBKDF2 hashes anything, but nobody types more. */
export const MAX_PASSWORD_LENGTH = 200;

/** Letters, digits, dots, dashes and underscores, starting with no symbol. */
const USERNAME_PATTERN = /^[\da-z][\d._a-z-]*$/;

/**
 * What each refusal says in English: the `message` a script, a log and a page
 * that does not know the code read. react-cheminfo's chrome catalog holds the
 * same sentences under `account.refusal.<code>`, in every language the family
 * speaks, and a test of the frontend keeps the two the same.
 */
export const REFUSAL_MESSAGES: Readonly<Record<AccountRefusal, string>> = {
  wrongCredentials: 'Wrong username or password.',
  tooManyAttempts: 'Too many sign-ins from here. Try again in 15 minutes.',
  signInElsewhere: "Signing in happens on this site's own pages.",
  signOutElsewhere: "Signing out happens on this site's own pages.",
  changeElsewhere: "Changes are made from this site's own pages.",
  signInRequired: 'This is for the accounts of this site: sign in.',
  sessionEnded: 'The session has ended: sign in again.',
  wrongToken: 'That is not the ADMIN_TOKEN of this server.',
  noAdminToken: 'No ADMIN_TOKEN is set on this server: sign in instead.',
  roleTooLow: 'Your account cannot do this: ask an administrator.',
  usernameLength: `A username has ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} characters.`,
  usernameCharacters:
    'A username holds letters, digits, dots, dashes and underscores, and starts with a letter or a digit.',
  usernameTaken: 'That username is taken.',
  passwordEmpty: 'A password cannot be empty.',
  passwordTooLong: `A password has at most ${MAX_PASSWORD_LENGTH} characters.`,
  noSuchAccount: 'That account no longer exists.',
  nothingToChange: 'Send a new password, a new role, or both.',
  useChangePassword:
    'Change your own password with POST /password, which asks for the current one.',
  ownRole: 'You cannot change your own role.',
  removeYourself: 'You cannot remove the account you are using.',
  lastAdmin: 'The last administrator can be neither removed nor demoted.',
  envManaged: "The server's .env defines this account, so it is changed there.",
  tokenCannotChangePassword:
    'A password is changed by the account signed in, not with the ADMIN_TOKEN.',
  wrongCurrentPassword: 'The current password is not that one.',
  accountRemoved: 'The account signed in was removed.',
};

/**
 * Whether a value is one of the roles.
 * @param value - anything read from a request, a row or a select
 * @returns true for `read`, `write` and `admin`
 */
export function isAccountRole(value: unknown): value is AccountRole {
  return (
    typeof value === 'string' &&
    (ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Whether a role may do what another one is needed for: `admin` does what
 * `write` does, and `write` what `read` does.
 * @param role - the account's role, or null and undefined for nobody
 * @param needed - the role the action needs
 * @returns true when `role` is `needed` or above it
 */
export function roleAllows(
  role: AccountRole | null | undefined,
  needed: AccountRole,
): boolean {
  if (role === null || role === undefined) return false;
  return ACCOUNT_ROLES.indexOf(role) >= ACCOUNT_ROLES.indexOf(needed);
}

/**
 * Whether a value is one of the refusal codes, rather than one of Fastify's
 * own (`FST_ERR_VALIDATION`) or nothing.
 * @param value - the `code` of a refusal's body
 * @returns true for a code of {@link ACCOUNT_REFUSALS}
 */
export function isAccountRefusal(value: unknown): value is AccountRefusal {
  return (
    typeof value === 'string' &&
    (ACCOUNT_REFUSALS as readonly string[]).includes(value)
  );
}

/**
 * A username as it is stored: trimmed and in lower case, so `Luc` and `luc`
 * are one account.
 * @param value - what was typed
 * @returns the username
 */
export function toUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Why a username cannot be used.
 * @param username - the username, as {@link toUsername} writes it
 * @returns the reason, or null when it can be
 */
export function usernameProblem(username: string): AccountProblem | null {
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    return 'usernameLength';
  }
  if (!USERNAME_PATTERN.test(username)) return 'usernameCharacters';
  return null;
}

/**
 * Why a password cannot be used.
 * @param password - the password, in clear
 * @returns the reason, or null when it can be
 */
export function passwordProblem(password: string): AccountProblem | null {
  if (password === '') return 'passwordEmpty';
  if (password.length > MAX_PASSWORD_LENGTH) return 'passwordTooLong';
  return null;
}
