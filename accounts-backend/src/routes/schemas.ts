import {
  ACCOUNT_ROLES,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
} from '../rules.ts';

/** The security scheme of the OpenAPI document a session-taking route names. */
export const SESSION_SCHEME = 'accountSession';

/** The security scheme of the OpenAPI document the operator's token names. */
export const TOKEN_SCHEME = 'operatorToken';

/** A role, as the routes take and answer it. */
export const ROLE_SCHEMA = {
  type: 'string',
  enum: ACCOUNT_ROLES,
  description:
    '`read` reads, `write` reads and writes, `admin` also manages the accounts',
} as const;

/** Where this browser stands: what the session routes answer. */
export const SESSION_SCHEMA = {
  type: 'object',
  required: ['signedIn', 'username', 'role'],
  properties: {
    signedIn: {
      type: 'boolean',
      description: 'Whether this browser holds a live session',
    },
    username: {
      type: ['string', 'null'],
      description: 'The account signed in, else null',
    },
    role: {
      type: ['string', 'null'],
      enum: [...ACCOUNT_ROLES, null],
      description: 'What the account signed in may do, else null',
    },
  },
} as const;

/** An account, as the routes list it: never its password hash. */
export const ACCOUNT_SCHEMA = {
  type: 'object',
  required: [
    'id',
    'username',
    'role',
    'envManaged',
    'createdAt',
    'passwordChangedAt',
    'lastSignInAt',
  ],
  properties: {
    id: { type: 'integer' },
    username: { type: 'string' },
    role: ROLE_SCHEMA,
    envManaged: {
      type: 'boolean',
      description:
        'Whether ADMIN_USERNAME and ADMIN_PASSWORD define it: it is then changed in .env, never here',
    },
    createdAt: { type: 'integer', description: 'In unix seconds' },
    passwordChangedAt: { type: 'integer', description: 'In unix seconds' },
    lastSignInAt: {
      type: ['integer', 'null'],
      description: 'In unix seconds; null before the first sign-in',
    },
  },
} as const;

/** What every refusal answers. */
export const ERROR_SCHEMA = {
  type: 'object',
  required: ['statusCode', 'error', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    error: { type: 'string' },
    message: { type: 'string', description: 'Why, in English' },
    code: {
      type: 'string',
      description:
        'Why, as a code a page writes in its own language: `account.refusal.<code>` of react-cheminfo',
    },
  },
} as const;

/** A password, as every route takes it. */
export const PASSWORD_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_PASSWORD_LENGTH,
} as const;

/** A username, as an account is added with it. */
export const USERNAME_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_USERNAME_LENGTH,
  description:
    'Letters, digits, dots, dashes and underscores; stored in lower case',
} as const;

/** The account a route names. */
export const ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

/** The OpenAPI security schemes the routes name. */
export interface AccountSecuritySchemes {
  /** The session cookie. */
  accountSession: {
    type: 'apiKey';
    in: 'cookie';
    name: string;
    description: string;
  };
  /** The operator's token, as a bearer token. */
  operatorToken: { type: 'http'; scheme: 'bearer'; description: string };
}

/**
 * The OpenAPI security schemes the routes name, for the host to list under
 * `components.securitySchemes` of its document.
 * @param cookieName - the cookie the session is kept in
 * @returns the schemes, by name
 */
export function accountSecuritySchemes(
  cookieName: string,
): AccountSecuritySchemes {
  return {
    [SESSION_SCHEME]: {
      type: 'apiKey',
      in: 'cookie',
      name: cookieName,
      description:
        "The session signing in opens. A change it asks for is taken from this site's own pages only.",
    },
    [TOKEN_SCHEME]: {
      type: 'http',
      scheme: 'bearer',
      description:
        "The operator's ADMIN_TOKEN, for scripts: it acts as an administrator.",
    },
  };
}
