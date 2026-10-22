import { fastifyCookie } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { isSameOrigin } from './isSameOrigin.ts';
import { sameSecret } from './sameSecret.ts';
import type { Sessions } from './sessions.ts';
import type { AccountRow, AccountStore } from './store/AccountStore.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The account a protected request was let through for, or null when the
     * operator's token let it through.
     */
    signedInAccount: AccountRow | null;
  }
}

/** The methods that change something. */
const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** What the guard and the routes share. */
export interface AccountsContext {
  /** The accounts. */
  store: () => Promise<AccountStore>;
  /** What opens and checks sessions. */
  sessions: Sessions;
  /** The cookie a session is kept in. */
  cookieName: string;
  /** The operator's token, or undefined when none is taken. */
  adminToken: string | undefined;
}

/**
 * The hook that lets the operator's token through, and the requests of an
 * account signed in, and refuses every other. A session changes nothing from
 * another site's page.
 * @param context - the accounts, the sessions and the operator's token
 * @returns the `onRequest` hook
 */
export function createGuard(context: AccountsContext) {
  const { sessions, cookieName, adminToken } = context;
  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    const token = bearerToken(request);
    if (
      adminToken !== undefined &&
      adminToken !== '' &&
      token !== undefined &&
      (await sameSecret(adminToken, token))
    ) {
      request.signedInAccount = null;
      return undefined;
    }

    const session = sessionCookie(request, cookieName);
    if (token === undefined && session !== undefined) {
      const store = await context.store();
      const account = await sessions.verify(session, (id) => store.byId(id));
      if (account !== null) {
        // The cookie is never sent from another site, and a browser names the
        // page a change comes from: refusing one from elsewhere is the second
        // lock on the same door.
        if (!CHANGES.has(request.method) || isSameOrigin(request)) {
          request.signedInAccount = account;
          return undefined;
        }
        request.log.warn(
          { clientIp: request.ip, origin: request.headers.origin },
          'refused an operator change from another site',
        );
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'the operator changes things from this site’s own pages',
        });
      }
    }

    request.log.warn({ clientIp: request.ip }, 'refused an operator request');
    return reply
      .code(401)
      .header('www-authenticate', 'Bearer')
      .send({
        statusCode: 401,
        error: 'Unauthorized',
        message: refusalOf(token, session, adminToken),
      });
  };
}

/**
 * The session cookie a request carries, whether or not a cookie parser runs
 * in the scope it is answered in.
 * @param request - the request
 * @param cookieName - the cookie a session is kept in
 * @returns the cookie's value, or undefined
 */
export function sessionCookie(
  request: FastifyRequest,
  cookieName: string,
): string | undefined {
  const parsed = (request as { cookies?: Record<string, string | undefined> })
    .cookies;
  if (parsed !== undefined) return parsed[cookieName];
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  return fastifyCookie.parse(header)[cookieName];
}

/**
 * Why a request was refused, in the words that say what to do about it.
 * @param token - the bearer token it sent, if any
 * @param session - the session cookie it sent, if any
 * @param adminToken - the operator's token, or undefined when none is set
 * @returns the message
 */
function refusalOf(
  token: string | undefined,
  session: string | undefined,
  adminToken: string | undefined,
): string {
  if (token !== undefined) {
    return adminToken === undefined || adminToken === ''
      ? 'no operator token is set on this server: sign in instead'
      : 'that is not the operator token';
  }
  if (session !== undefined) return 'the session has ended: sign in again';
  return 'this page is for the operator: sign in';
}

/**
 * The token of an `Authorization: Bearer` header.
 * @param request - the request
 * @returns the token, or undefined without one
 */
function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  return /^Bearer\s+(?<token>\S+)\s*$/i.exec(header)?.groups?.token;
}
