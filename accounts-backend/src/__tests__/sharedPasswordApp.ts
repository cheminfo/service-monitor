import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';

import { createSharedPassword } from '../createSharedPassword.ts';
import { hashPassword } from '../password.ts';
import type { SharedPasswordOptions } from '../sharedPasswordTypes.ts';

import {
  ADMIN_TOKEN,
  COOKIE,
  HOST,
  PURPOSE,
  SAME_SITE,
  SECRET,
} from './testApp.ts';

/** The shared password of the test site. */
export const SHARED = 'the shared password';

/** Where the test site keeps the hash of its shared password. */
export interface HashHolder {
  hash: string | undefined;
}

/** A test site signed in with one shared password. */
export interface SharedPasswordApp {
  app: FastifyInstance;
  holder: HashHolder;
}

/**
 * A site whose operators share one password, its routes under `/v1/auth`,
 * and routes of its own:
 * - `/v1/printers` (GET, POST), reads open to everybody, changes guarded;
 * - `/v1/admin/system` (GET), in a scope guarded for every method;
 * - `/v1/open` (GET), open to everybody, saying whether it was signed in.
 * @param options - How the site is built.
 * @param options.hash - The hash kept at the start; the shared password's when left out.
 * @param options.access - Options of `createSharedPassword` to change.
 * @returns The site and the hash it keeps.
 */
export async function sharedPasswordApp(
  options: {
    hash?: string | null;
    access?: Partial<SharedPasswordOptions>;
  } = {},
): Promise<SharedPasswordApp> {
  const holder: HashHolder = {
    hash:
      options.hash === null
        ? undefined
        : (options.hash ?? (await hashPassword(SHARED))),
  };
  const access = await createSharedPassword({
    cookieName: COOKIE,
    purpose: PURPOSE,
    cookieSecret: SECRET,
    adminToken: ADMIN_TOKEN,
    production: false,
    readPasswordHash: () => holder.hash,
    writePasswordHash: (hash) => {
      holder.hash = hash;
    },
    ...options.access,
  });
  const app = fastify({ logger: false });
  await app.register(access.routes, { prefix: '/v1/auth' });
  await app.register(
    async (scope) => {
      access.protect(scope, { openReads: true });
      scope.get('/printers', () => ({ printers: [] }));
      scope.post('/printers', () => ({ added: true }));
    },
    { prefix: '/v1' },
  );
  await app.register(
    async (scope) => {
      access.protect(scope);
      scope.get('/system', () => ({ system: 'ok' }));
    },
    { prefix: '/v1/admin' },
  );
  app.get('/v1/open', async (request) => ({
    signedIn: await access.signedIn(request),
  }));
  await app.ready();
  return { app, holder };
}

/**
 * Sign in with a password, from the site's own page.
 * @param app - The site.
 * @param password - The password typed.
 * @param headers - Extra request headers.
 * @param remoteAddress - The client the request comes from.
 * @returns The response.
 */
export function signInShared(
  app: FastifyInstance,
  password: string,
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress,
    payload: { password },
    headers: { host: HOST, ...headers },
  });
}

/**
 * Sign in, and keep the session's cookie.
 * @param app - The site.
 * @param password - The password typed.
 * @returns The cookie's value.
 */
export async function sharedSessionOf(
  app: FastifyInstance,
  password = SHARED,
): Promise<string> {
  const response = await signInShared(app, password);
  return response.cookies[0]?.value ?? '';
}

/**
 * A request with a session, from the site's own page.
 * @param app - The site.
 * @param session - The session's cookie.
 * @param method - The method.
 * @param url - The route.
 * @param payload - What to send.
 * @returns The response.
 */
export function withSession(
  app: FastifyInstance,
  session: string,
  method: 'GET' | 'POST',
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
