import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import type { EnvAdminEnvironment, EnvAdminOutcome } from './envAdmin.ts';
import type { SignedIn } from './guard.ts';
import type { AccountSecuritySchemes } from './routes/schemas.ts';
import type { AccountRole } from './rules.ts';
import type { AccountStore } from './store/AccountStore.ts';

/** How many sign-ins one client may try per fifteen minutes, unless told. */
export const DEFAULT_SIGN_IN_LIMIT = 10;

/** The store, or what opens it. */
export type AccountStoreSource =
  | AccountStore
  | Promise<AccountStore>
  | (() => AccountStore | Promise<AccountStore>);

/** What a service's accounts are made with. */
export interface ServiceAccountsOptions {
  /**
   * The accounts: `accountStoreOpener(accountStorePath(DATA_DIR))`. A
   * function is called at every request.
   */
  store: AccountStoreSource;
  /**
   * The cookie a session is kept in. One name per site, so two sites served
   * from one host do not overwrite each other's: `chembio_operator`.
   */
  cookieName: string;
  /**
   * What sessions sign besides the account, so nothing else the same key
   * signs can pass for one: the site's name.
   */
  purpose: string;
  /**
   * The key sessions are signed with, `COOKIE_SECRET`. Required in
   * production, where a random key would sign everybody out at every restart.
   * @default undefined — outside production, a random key drawn at start, said once in the log
   */
  cookieSecret?: string;
  /**
   * The operator's token, which a script sends as a bearer token instead of
   * signing in, `ADMIN_TOKEN`. It acts as an administrator.
   * @default undefined — no bearer token is taken
   */
  adminToken?: string;
  /**
   * How many sign-ins one client may try per fifteen minutes.
   * @default 10
   */
  signInLimit?: number;
  /**
   * Whether the server runs in production, where `cookieSecret` is required.
   * @default process.env.NODE_ENV === 'production'
   */
  production?: boolean;
}

/** How a scope of the host's is guarded. */
export interface ProtectOptions {
  /**
   * The role every route of the scope needs at least. A route asks for more
   * with `config: { accountRole: 'admin' }`.
   * @default 'read'
   */
  role?: AccountRole;
}

/** A service's accounts: their routes, and the guard of the host's own. */
export interface ServiceAccounts {
  /**
   * Signing in and out, open to everybody, and the accounts behind the guard.
   * Register it with the prefix the site chooses: `/v1/account`, or the
   * `/v1/admin` the operator's routes share.
   */
  routes: FastifyPluginAsync;
  /**
   * Guard every route registered after it in a scope of the host's: 401 when
   * nobody is signed in, 403 below the role, `request.signedInAccount` set
   * (null for the operator's token), and the two credentials named in the
   * OpenAPI document.
   * @param scope - an encapsulated scope, so the routes beside it stay open
   * @param options - the role the scope needs
   */
  protect: (scope: FastifyInstance, options?: ProtectOptions) => void;
  /**
   * Who a request comes from, refusing nobody: an account signed in, the
   * operator's token (`account` null, role `admin`), or null for anybody
   * else. For a route open to everybody that shows more to the accounts,
   * which should then answer `Cache-Control: private`.
   * @param request - the request
   * @returns who, or null
   */
  signedIn: (request: FastifyRequest) => Promise<SignedIn | null>;
  /**
   * Make the administrator the `.env` defines exist, as it says. Call it once,
   * as the server starts.
   * @param log - where to say what was done
   * @param env - the environment to read; `process.env` when left out
   * @returns what was done
   */
  syncEnvAdmin: (
    log: FastifyBaseLogger,
    env?: EnvAdminEnvironment,
  ) => Promise<EnvAdminOutcome>;
  /** The security schemes, for `components.securitySchemes` of the host. */
  securitySchemes: AccountSecuritySchemes;
}
