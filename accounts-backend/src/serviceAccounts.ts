import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifySchema,
} from 'fastify';

import type { FirstAccountEnvironment } from './firstAccount.ts';
import { firstAccount } from './firstAccount.ts';
import type { AccountsContext } from './guard.ts';
import { createGuard } from './guard.ts';
import { accountRoutes } from './routes/accountRoutes.ts';
import type { DocumentedSchema } from './routes/documented.ts';
import {
  ERROR_SCHEMA,
  SESSION_SCHEME,
  TOKEN_SCHEME,
  accountSecuritySchemes,
} from './routes/schemas.ts';
import { sessionRoutes } from './routes/sessionRoutes.ts';
import { createSessions } from './sessions.ts';
import type { AccountStore } from './store/AccountStore.ts';
import type { Account } from './types.ts';

/** How many sign-ins one client may try per window, unless told otherwise. */
const SIGN_IN_LIMIT = 10;

/** The store, or what opens it. */
export type AccountStoreSource =
  | AccountStore
  | Promise<AccountStore>
  | (() => AccountStore | Promise<AccountStore>);

/** What a service's accounts are made with. */
export interface ServiceAccountsOptions {
  /** The accounts; a function is called at every request. */
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
   * The key sessions are signed with, `COOKIE_SECRET`.
   * @default undefined — a random key drawn at start, so a restart signs everybody out
   */
  cookieSecret?: string;
  /**
   * The operator's token, which a script sends as a bearer token instead of
   * signing in, `ADMIN_TOKEN`.
   * @default undefined — no bearer token is taken
   */
  adminToken?: string;
  /**
   * How many sign-ins one client may try per fifteen minutes.
   * @default 10
   */
  signInLimit?: number;
}

/** A service's accounts: their routes, and the guard of the host's own. */
export interface ServiceAccounts {
  /**
   * Signing in and out, open to everybody, and the accounts behind the guard.
   * Register it with the prefix the operator's routes share, `/v1/admin`.
   */
  routes: FastifyPluginAsync;
  /**
   * Guard every route registered after it in a scope of the host's: the
   * operator's token or an account signed in, `request.signedInAccount` set,
   * and the two credentials named in the OpenAPI document.
   * @param scope - an encapsulated scope, so the routes beside it stay open
   */
  protect: (scope: FastifyInstance) => void;
  /**
   * Create the first account when the store has none, from ADMIN_USERNAME and
   * ADMIN_PASSWORD. Call it once, as the server starts.
   * @param log - where to say what was done
   * @param env - the environment to read
   * @returns the account created, or null
   */
  ensureFirstAccount: (
    log: FastifyInstance['log'],
    env?: FirstAccountEnvironment,
  ) => Promise<Account | null>;
  /** The security schemes, for `components.securitySchemes` of the host. */
  securitySchemes: ReturnType<typeof accountSecuritySchemes>;
}

/**
 * The accounts that sign in to a service's operator's pages.
 *
 * ```ts
 * const accounts = await createServiceAccounts({
 *   store: accountStoreOpener(accountStorePath(DATA_DIR)),
 *   cookieName: 'chembio_operator',
 *   purpose: 'chembio.cheminfo.org operator session',
 *   cookieSecret: process.env.COOKIE_SECRET,
 *   adminToken: process.env.ADMIN_TOKEN,
 * });
 * await fastify.register(accounts.routes, { prefix: '/v1/admin' });
 * await fastify.register((scope) => {
 *   accounts.protect(scope);
 *   scope.get('/status', …);
 * }, { prefix: '/v1/admin' });
 * ```
 * @param options - the store, the cookie, and the operator's token
 * @returns the routes and the guard
 */
export async function createServiceAccounts(
  options: ServiceAccountsOptions,
): Promise<ServiceAccounts> {
  const {
    store,
    cookieName,
    purpose,
    cookieSecret,
    adminToken,
    signInLimit = SIGN_IN_LIMIT,
  } = options;
  const context: AccountsContext = {
    store: async () => (typeof store === 'function' ? store() : store),
    sessions: await createSessions({ purpose, secret: cookieSecret }),
    cookieName,
    adminToken: adminToken?.trim() || undefined,
  };
  const guard = createGuard(context);

  function protect(scope: FastifyInstance): void {
    if (!scope.hasRequestDecorator('signedInAccount')) {
      scope.decorateRequest('signedInAccount', null);
    }
    scope.addHook('onRequest', guard);
    scope.addHook('onRoute', (route) => {
      const schema = route.schema as DocumentedSchema | undefined;
      route.schema = {
        ...schema,
        security: schema?.security ?? [
          { [SESSION_SCHEME]: [] },
          { [TOKEN_SCHEME]: [] },
        ],
        response: {
          ...(schema?.response as Record<string, unknown> | undefined),
          401: ERROR_SCHEMA,
        },
      } as FastifySchema;
    });
  }

  const routes: FastifyPluginAsync = async (instance) => {
    if (!instance.hasReplyDecorator('setCookie')) {
      await instance.register(fastifyCookie);
    }
    if (!instance.hasDecorator('rateLimit')) {
      await instance.register(fastifyRateLimit, { global: false });
    }
    sessionRoutes(instance, context, signInLimit);
    await instance.register(async (guarded) => {
      protect(guarded);
      accountRoutes(guarded, context);
    });
  };

  return {
    routes,
    protect,
    ensureFirstAccount: async (log, env) =>
      firstAccount(await context.store(), log, env),
    securitySchemes: accountSecuritySchemes(cookieName),
  };
}
