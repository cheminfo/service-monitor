import process from 'node:process';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifySchema } from 'fastify';

import type { SessionContext } from './guard.ts';
import { CHANGES, createGuard } from './guard.ts';
import type { DocumentedSchema } from './routes/documented.ts';
import {
  ERROR_SCHEMA,
  SESSION_SCHEME,
  TOKEN_SCHEME,
} from './routes/schemas.ts';
import type { AccountRole } from './rules.ts';
import type { SessionOptions } from './serviceAccountsTypes.ts';
import { createSessions } from './sessions.ts';

/** What both kinds of sign-in start from. */
export interface SessionSetup {
  /** The sessions, the cookie and the operator's token. */
  context: SessionContext;
  /**
   * Register what the routes need in their scope, the cookies and the rate
   * limit, unless the host already has; say once when a random key signs.
   * @param instance - the scope the routes are registered in
   */
  prepare: (instance: FastifyInstance) => Promise<void>;
}

/**
 * The sessions a sign-in opens, signed with `COOKIE_SECRET`.
 * @param options - the cookie, the key and the operator's token
 * @param findAccount - reads the account a session names
 * @returns the context, and what prepares the routes' scope
 * @throws {Error} When `production` and no `cookieSecret` is given, saying
 * how to set one.
 */
export async function createSessionSetup(
  options: SessionOptions,
  findAccount: SessionContext['findAccount'],
): Promise<SessionSetup> {
  const {
    cookieName,
    purpose,
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
  const context: SessionContext = {
    findAccount,
    sessions: await createSessions({ purpose, secret: cookieSecret }),
    cookieName,
    adminToken,
  };
  let toldRandomKey = cookieSecret !== undefined;
  return {
    context,
    async prepare(instance) {
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
    },
  };
}

/**
 * Guard every route registered after it in a scope, and name the credentials
 * they take in the OpenAPI document.
 * @param scope - an encapsulated scope, so the routes beside it stay open
 * @param context - the sessions and the operator's token
 * @param role - the role every route of the scope needs at least
 * @param openReads - whether a request that changes nothing passes for
 * everybody, its routes then documented without credentials
 */
export function protectScope(
  scope: FastifyInstance,
  context: SessionContext,
  role: AccountRole,
  openReads: boolean,
): void {
  if (!scope.hasRequestDecorator('signedInAccount')) {
    scope.decorateRequest('signedInAccount', null);
  }
  scope.addHook('onRequest', createGuard(context, role, openReads));
  scope.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    if (openReads && !methods.some((method) => CHANGES.has(method))) return;
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

/**
 * A setting as given, trimmed, or undefined when it says nothing.
 * @param value - the setting
 * @returns it, or undefined
 */
function blankless(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
