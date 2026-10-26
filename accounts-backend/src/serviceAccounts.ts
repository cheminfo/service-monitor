import process from 'node:process';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifySchema,
} from 'fastify';

import { syncEnvAdmin } from './envAdmin.ts';
import type { AccountsContext } from './guard.ts';
import { createGuard, signedInOf } from './guard.ts';
import { accountRoutes } from './routes/accountRoutes.ts';
import type { DocumentedSchema } from './routes/documented.ts';
import { passwordRoute } from './routes/passwordRoute.ts';
import {
  ERROR_SCHEMA,
  SESSION_SCHEME,
  TOKEN_SCHEME,
  accountSecuritySchemes,
} from './routes/schemas.ts';
import { sessionRoutes } from './routes/sessionRoutes.ts';
import { isAccountRole } from './rules.ts';
import type {
  ProtectOptions,
  ServiceAccounts,
  ServiceAccountsOptions,
} from './serviceAccountsTypes.ts';
import { DEFAULT_SIGN_IN_LIMIT } from './serviceAccountsTypes.ts';
import { createSessions } from './sessions.ts';

/**
 * The accounts that sign in to a service.
 *
 * ```ts
 * const accounts = await createServiceAccounts({
 *   store: accountStoreOpener(accountStorePath(DATA_DIR)),
 *   cookieName: 'drugs_session',
 *   purpose: 'drugs.cheminfo.org session',
 *   ...readAccountConfig(),
 * });
 * await fastify.register(accounts.routes, { prefix: '/v1/account' });
 * await fastify.register((scope) => {
 *   accounts.protect(scope, { role: 'write' });
 *   scope.post('/samples', …);
 * }, { prefix: '/v1' });
 * await accounts.syncEnvAdmin(fastify.log);
 * ```
 * @param options - the store, the cookie, the key and the operator's token
 * @returns the routes, the guard and the rest
 * @throws {Error} When `production` and no `cookieSecret` is given, saying
 * how to set one.
 */
export async function createServiceAccounts(
  options: ServiceAccountsOptions,
): Promise<ServiceAccounts> {
  const {
    store,
    cookieName,
    purpose,
    signInLimit = DEFAULT_SIGN_IN_LIMIT,
    production = process.env.NODE_ENV === 'production',
  } = options;
  // Blank is unset: the compose files hand an unset variable over as ''.
  const cookieSecret = blankless(options.cookieSecret);
  const adminToken = blankless(options.adminToken);
  if (production && cookieSecret === undefined) {
    throw new Error(
      'COOKIE_SECRET is unset, and in production every restart would then sign everybody out. Set it in .env to the output of `openssl rand -hex 32`, then restart.',
    );
  }
  const context: AccountsContext = {
    store: async () => (typeof store === 'function' ? store() : store),
    sessions: await createSessions({ purpose, secret: cookieSecret }),
    cookieName,
    adminToken,
  };
  let toldRandomKey = cookieSecret !== undefined;

  function protect(
    scope: FastifyInstance,
    protectOptions: ProtectOptions = {},
  ): void {
    const { role = 'read' } = protectOptions;
    if (!isAccountRole(role)) {
      throw new Error(
        `protect: "${String(role)}" is no role: read, write or admin`,
      );
    }
    if (!scope.hasRequestDecorator('signedInAccount')) {
      scope.decorateRequest('signedInAccount', null);
    }
    scope.addHook('onRequest', createGuard(context, role));
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
          403: ERROR_SCHEMA,
        },
      } as FastifySchema;
    });
  }

  const routes: FastifyPluginAsync = async (instance) => {
    if (!toldRandomKey) {
      toldRandomKey = true;
      instance.log.warn(
        'COOKIE_SECRET is unset: a random key signs the sessions, so a restart signs everybody out',
      );
    }
    if (!instance.hasReplyDecorator('setCookie')) {
      await instance.register(fastifyCookie);
    }
    if (!instance.hasDecorator('rateLimit')) {
      await instance.register(fastifyRateLimit, { global: false });
    }
    sessionRoutes(instance, context, signInLimit);
    await instance.register(async (guarded) => {
      protect(guarded);
      passwordRoute(guarded, context);
      accountRoutes(guarded, context);
    });
  };

  return {
    routes,
    protect,
    signedIn: (request) => signedInOf(context, request),
    syncEnvAdmin: async (log, env) =>
      syncEnvAdmin(await context.store(), log, env),
    securitySchemes: accountSecuritySchemes(cookieName),
  };
}

/**
 * A setting as given, trimmed, or undefined when it says nothing.
 * @param value - the setting
 * @returns it, or undefined
 */
function blankless(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
