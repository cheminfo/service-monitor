import {
  ACCOUNT_ROLES,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
} from '../rules.ts';

/** The security scheme of the OpenAPI document a session-taking route names. */
export const SESSION_SCHEME = 'accountSession';

/** The security scheme of the OpenAPI document the operator's token names. */
export const TOKEN_SCHEME = 'operatorToken';

/** The security scheme of the OpenAPI document an account's API token names. */
export const ACCOUNT_TOKEN_SCHEME = 'accountToken';

/** The security scheme of the OpenAPI document a token in `?token=` names. */
export const QUERY_TOKEN_SCHEME = 'queryToken';

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

/** Every OpenAPI security scheme the routes can name, by its name. */
interface AccountSecuritySchemeMap {
  /** The session cookie. */
  accountSession: {
    type: 'apiKey';
    in: 'cookie';
    name: string;
    description: string;
  };
  /** The operator's token, as a bearer token. */
  operatorToken: { type: 'http'; scheme: 'bearer'; description: string };
  /**
   * An account's API token, as a bearer token: present only when
   * `verifyToken` is given.
   */
  accountToken: { type: 'http'; scheme: 'bearer'; description: string };
  /** A token sent as `?token=`: present only when `tokenQueryParameter` is true. */
  queryToken: {
    type: 'apiKey';
    in: 'query';
    name: 'token';
    description: string;
  };
}

/**
 * The OpenAPI security schemes the routes name: the session's and the
 * operator's always, the others only when the site takes them. Mapped types
 * rather than an interface, because only they carry the implicit index
 * signature that `components.securitySchemes` of `@fastify/swagger` asks for.
 */
export type AccountSecuritySchemes = Pick<
  AccountSecuritySchemeMap,
  typeof SESSION_SCHEME | typeof TOKEN_SCHEME
> &
  Partial<
    Pick<
      AccountSecuritySchemeMap,
      typeof ACCOUNT_TOKEN_SCHEME | typeof QUERY_TOKEN_SCHEME
    >
  >;

/** The tokens a site takes besides its operator's, for its OpenAPI document. */
export interface TokenSchemeOptions {
  /**
   * Whether accounts' API tokens are taken: `verifyToken` is given.
   * @default false
   */
  accountTokens?: boolean;
  /**
   * Whether a token is read from `?token=`: `tokenQueryParameter`.
   * @default false
   */
  queryToken?: boolean;
}

/**
 * The OpenAPI security schemes the routes name, for the host to list under
 * `components.securitySchemes` of its document.
 * @param cookieName - the cookie the session is kept in
 * @param tokens - the tokens taken besides the operator's
 * @returns the schemes, by name
 */
export function accountSecuritySchemes(
  cookieName: string,
  tokens: TokenSchemeOptions = {},
): AccountSecuritySchemes {
  const schemes: AccountSecuritySchemes = {
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
  if (tokens.accountTokens) {
    schemes[ACCOUNT_TOKEN_SCHEME] = {
      type: 'http',
      scheme: 'bearer',
      description:
        "An account's API token, for its scripts: it acts as that account, with its role.",
    };
  }
  if (tokens.queryToken) {
    schemes[QUERY_TOKEN_SCHEME] = {
      type: 'apiKey',
      in: 'query',
      name: 'token',
      description:
        'Any token above, as `?token=`, for a client that cannot send a header. It is written in the access logs.',
    };
  }
  return schemes;
}

/**
 * The credentials a guarded route takes, one of which is enough.
 * @param tokens - the tokens taken besides the operator's
 * @returns the route's `security`
 */
export function guardedSecurity(
  tokens: TokenSchemeOptions,
): Array<Record<string, string[]>> {
  const security: Array<Record<string, string[]>> = [
    { [SESSION_SCHEME]: [] },
    { [TOKEN_SCHEME]: [] },
  ];
  if (tokens.accountTokens) security.push({ [ACCOUNT_TOKEN_SCHEME]: [] });
  if (tokens.queryToken) security.push({ [QUERY_TOKEN_SCHEME]: [] });
  return security;
}
