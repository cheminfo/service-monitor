import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { syncEnvAdmin } from './envAdmin.ts';
import type { AccountsContext } from './guard.ts';
import { signedInOf } from './guard.ts';
import { accountRoutes } from './routes/accountRoutes.ts';
import { passwordRoute } from './routes/passwordRoute.ts';
import { accountSecuritySchemes } from './routes/schemas.ts';
import { sessionRoutes } from './routes/sessionRoutes.ts';
import { isAccountRole } from './rules.ts';
import type {
  ProtectOptions,
  ServiceAccounts,
  ServiceAccountsOptions,
} from './serviceAccountsTypes.ts';
import { DEFAULT_SIGN_IN_LIMIT } from './serviceAccountsTypes.ts';
import { createSessionSetup, protectScope } from './sessionSetup.ts';

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
  const { store, cookieName, signInLimit = DEFAULT_SIGN_IN_LIMIT } = options;
  const storeOf = async () => (typeof store === 'function' ? store() : store);
  const setup = await createSessionSetup(options, async (id) => {
    const opened = await storeOf();
    return opened.byId(id);
  });
  const context: AccountsContext = { ...setup.context, store: storeOf };

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
    protectScope(scope, context, role, false);
  }

  const routes: FastifyPluginAsync = async (instance) => {
    await setup.prepare(instance);
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
