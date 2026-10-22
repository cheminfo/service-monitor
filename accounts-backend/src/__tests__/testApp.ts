import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import { createAccount } from '../accounts.ts';
import { createServiceAccounts } from '../serviceAccounts.ts';
import { AccountStore } from '../store/AccountStore.ts';

/** The host the test site is served from. */
export const HOST = 'test.cheminfo.org';

/** The cookie the test site keeps its sessions in. */
export const COOKIE = 'test_operator';

/** The operator's token of the test site. */
export const ADMIN_TOKEN = 'operator-test-token';

/** The password of the test site's first account, `admin`. */
export const PASSWORD = 'the administrator password';

/** A test site: its accounts, and one operator's route of its own. */
export interface TestApp {
  app: FastifyInstance;
  store: AccountStore;
}

/**
 * A site with two accounts, `admin` and `ada`, the accounts' routes under
 * `/v1/admin`, and a protected `GET /v1/admin/status` of its own.
 * @param options - how the site is built
 * @param options.logger - what the server logs to
 * @returns the site and its accounts
 */
export async function testApp(
  options: { logger?: object | boolean } = {},
): Promise<TestApp> {
  const store = await AccountStore.open(':memory:');
  await createAccount(store, { username: 'admin', password: PASSWORD });
  await createAccount(store, { username: 'ada', password: 'her own password' });
  const accounts = await createServiceAccounts({
    store,
    cookieName: COOKIE,
    purpose: 'test.cheminfo.org operator session',
    cookieSecret: 'a cookie secret of some length',
    adminToken: ADMIN_TOKEN,
  });
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: '192.168.1.5',
  });
  await app.register(accounts.routes, { prefix: '/v1/admin' });
  await app.register(
    async (scope) => {
      accounts.protect(scope);
      scope.get('/status', (request) => ({
        by: request.signedInAccount?.username ?? 'token',
      }));
      scope.post('/refresh', () => ({ refreshed: true }));
    },
    { prefix: '/v1/admin' },
  );
  await app.ready();
  return { app, store };
}

/**
 * The cookies a response sets, as plain objects: the parser hands them out
 * without a prototype, which a strict comparison tells apart.
 * @param response - the response
 * @param response.cookies - the cookies it sets
 * @returns one object per cookie
 */
export function cookiesOf(response: { cookies: object[] }) {
  return response.cookies.map((cookie) => ({ ...cookie }));
}
