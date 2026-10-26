import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fastify } from 'fastify';

import { createAccount } from '../accounts.ts';
import { createServiceAccounts } from '../serviceAccounts.ts';
import type { ServiceAccountsOptions } from '../serviceAccountsTypes.ts';
import { AccountStore } from '../store/AccountStore.ts';

/** The host the test site is served from. */
export const HOST = 'test.cheminfo.org';

/** The cookie the test site keeps its sessions in. */
export const COOKIE = 'test_session';

/** What the test site's sessions sign besides the account. */
export const PURPOSE = 'test.cheminfo.org session';

/** The key the test site signs its sessions with. */
export const SECRET = 'a cookie secret of some length';

/** The operator's token of the test site. */
export const ADMIN_TOKEN = 'operator-test-token';

/** The password of the test site's administrator, `admin`. */
export const PASSWORD = 'the administrator password';

/** The passwords of the two other accounts. */
export const ADA_PASSWORD = 'her own password';
export const BOB_PASSWORD = 'his own password';

/** Headers a page of the site sends with a change. */
export const SAME_SITE = { host: HOST, origin: `https://${HOST}` };

/** A test site: its accounts, and routes of its own. */
export interface TestApp {
  app: FastifyInstance;
  store: AccountStore;
}

/**
 * A site with three accounts — `admin` (admin, id 1), `ada` (write, id 2) and
 * `bob` (read, id 3) — the accounts' routes under `/v1/account`, and routes
 * of its own:
 * - `/v1/data/status` (GET) and `/v1/data/refresh` (POST), for any account;
 * - `/v1/data/samples`: POST for `write`, DELETE for `admin`, by route;
 * - `/v1/admin/system` (GET), in a scope protected for `admin`;
 * - `/v1/open` (GET and POST), open to everybody, saying who asked.
 * @param options - How the site is built.
 * @param options.logger - What the server logs to.
 * @param options.accounts - Options of `createServiceAccounts` to change.
 * @returns The site and its accounts.
 */
export async function testApp(
  options: {
    logger?: object | boolean;
    accounts?: Partial<ServiceAccountsOptions>;
  } = {},
): Promise<TestApp> {
  const store = await AccountStore.open(':memory:');
  await createAccount(store, {
    username: 'admin',
    password: PASSWORD,
    role: 'admin',
  });
  await createAccount(store, {
    username: 'ada',
    password: ADA_PASSWORD,
    role: 'write',
  });
  await createAccount(store, { username: 'bob', password: BOB_PASSWORD });
  const accounts = await createServiceAccounts({
    store,
    cookieName: COOKIE,
    purpose: PURPOSE,
    cookieSecret: SECRET,
    adminToken: ADMIN_TOKEN,
    production: false,
    ...options.accounts,
  });
  const app = fastify({
    logger: options.logger ?? false,
    trustProxy: '192.168.1.5',
  });
  await app.register(accounts.routes, { prefix: '/v1/account' });
  await app.register(
    async (scope) => {
      accounts.protect(scope);
      scope.get('/status', (request) => ({
        by: request.signedInAccount?.username ?? 'token',
      }));
      scope.post('/refresh', () => ({ refreshed: true }));
      scope.post('/samples', { config: { accountRole: 'write' } }, () => ({
        written: true,
      }));
      scope.delete('/samples', { config: { accountRole: 'admin' } }, () => ({
        purged: true,
      }));
    },
    { prefix: '/v1/data' },
  );
  await app.register(
    async (scope) => {
      accounts.protect(scope, { role: 'admin' });
      scope.get('/system', () => ({ system: 'ok' }));
    },
    { prefix: '/v1/admin' },
  );
  const askedBy = async (request: FastifyRequest) => {
    const signedIn = await accounts.signedIn(request);
    if (signedIn === null) return { by: 'nobody' };
    return {
      by: signedIn.account?.username ?? 'token',
      role: signedIn.role,
    };
  };
  app.get('/v1/open', askedBy);
  app.post('/v1/open', askedBy);
  await app.ready();
  return { app, store };
}

/**
 * Sign in, and keep the session's cookie.
 * @param app - The site.
 * @param username - Who.
 * @param password - Their password.
 * @returns The cookie's value.
 */
export async function sessionOf(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const login = await app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username, password },
  });
  return login.cookies[0]?.value ?? '';
}

/**
 * A request of an account signed in, from the site's own page.
 * @param app - The site.
 * @param session - The session's cookie.
 * @param method - The method.
 * @param url - The route.
 * @param payload - What to send.
 * @returns The response.
 */
export function asAccount(
  app: FastifyInstance,
  session: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    payload,
    headers: SAME_SITE,
    cookies: { [COOKIE]: session },
  });
}

/**
 * The cookies a response sets, as plain objects: the parser hands them out
 * without a prototype, which a strict comparison tells apart.
 * @param response - The response.
 * @param response.cookies - The cookies it sets.
 * @returns One object per cookie.
 */
export function cookiesOf(response: { cookies: object[] }) {
  return response.cookies.map((cookie) => ({ ...cookie }));
}

/**
 * The status and the refusal code of each request, in order.
 * @param responses - The responses.
 * @returns `[status, code]` per response, the code undefined on a success.
 */
export function outcomes(
  responses: Array<{ statusCode: number; json: () => { code?: string } }>,
) {
  return responses.map((response) => [
    response.statusCode,
    response.statusCode < 400 ? undefined : response.json().code,
  ]);
}
