import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyBaseLogger } from 'fastify';
import { fastify } from 'fastify';
import { onTestFinished } from 'vitest';

import { createServiceAccounts } from '../serviceAccounts.ts';
import type { AccountStore } from '../store/AccountStore.ts';

import { COOKIE, PURPOSE, SECRET } from './testApp.ts';

/**
 * A logger that keeps what it was told.
 * @returns The logger, and the lines as `[level, message, context]`.
 */
export function recorder() {
  const lines: Array<[string, string, unknown]> = [];
  const keep =
    (level: string) =>
    (context: unknown, message?: string): void => {
      if (typeof context === 'string') lines.push([level, context, undefined]);
      else lines.push([level, message ?? '', context]);
    };
  const log = {
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  } as unknown as FastifyBaseLogger;
  return { log, lines };
}

/**
 * A store in a file of its own, removed when the test finishes.
 * @returns Its path.
 */
export function storePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'service-accounts-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'sqlite', 'accounts.sqlite');
}

/**
 * A server on a store, started the way a site starts: the accounts made, the
 * administrator of the .env synchronised, the routes registered.
 * @param store - The accounts.
 * @param env - What the .env holds.
 * @returns The server, and what the synchronisation said.
 */
export async function start(store: AccountStore, env: Record<string, string>) {
  const accounts = await createServiceAccounts({
    store,
    cookieName: COOKIE,
    purpose: PURPOSE,
    cookieSecret: SECRET,
    production: false,
  });
  const { log, lines } = recorder();
  const outcome = await accounts.syncEnvAdmin(log, env);
  const app = fastify();
  await app.register(accounts.routes, { prefix: '/v1/account' });
  await app.ready();
  onTestFinished(() => app.close());
  return { app, outcome, lines };
}

/**
 * Whether a cookie still opens a session on a server.
 * @param app - The server.
 * @param cookie - The session's cookie.
 * @returns The username it is signed in as, or null.
 */
export async function signedInAs(
  app: Awaited<ReturnType<typeof start>>['app'],
  cookie: string,
): Promise<string | null> {
  const response = await app.inject({
    url: '/v1/account/session',
    cookies: { [COOKIE]: cookie },
  });
  return response.json<{ username: string | null }>().username;
}
