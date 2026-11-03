import { fastifyCookie } from '@fastify/cookie';
import type { FastifyRequest } from 'fastify';

import { isSameOrigin } from './isSameOrigin.ts';
import type { AccountRefusal } from './rules.ts';
import { sameSecret } from './sameSecret.ts';
import type { SessionContext } from './sessionContext.ts';
import type { AccountRow } from './store/accountRows.ts';

/** The methods that change something. */
export const CHANGES: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** What a request's credentials say, before anything is decided on them. */
export type Identity =
  | { status: 'token' }
  | { status: 'account'; account: AccountRow }
  | { status: 'elsewhere' }
  | {
      status: 'nobody';
      token: string | undefined;
      session: string | undefined;
    };

/**
 * Read a request's credentials: the operator's token, an account's API
 * token, or a session that is still valid. A valid session asking for a
 * change from another site's page is `elsewhere`: the cookie is never sent
 * from another site, and a browser names the page a change comes from, so
 * refusing it is the second lock on the same door. A token is no cookie, so
 * it is taken from anywhere.
 * @param context - the sessions and the tokens
 * @param request - the request
 * @returns what they say
 */
export async function identify(
  context: SessionContext,
  request: FastifyRequest,
): Promise<Identity> {
  const {
    sessions,
    cookieName,
    adminToken,
    verifyToken,
    tokenQueryParameter,
    findAccount,
  } = context;
  const token = requestToken(request, tokenQueryParameter);
  if (token !== undefined) {
    if (
      adminToken !== undefined &&
      adminToken !== '' &&
      (await sameSecret(adminToken, token))
    ) {
      return { status: 'token' };
    }
    const account = await verifyToken?.(token);
    if (account !== undefined) return { status: 'account', account };
  }

  const session = sessionCookie(request, cookieName);
  if (token === undefined && session !== undefined) {
    const verified = await sessions.verify(session, findAccount);
    if (verified !== null) {
      if (!CHANGES.has(request.method) || isSameOrigin(request)) {
        return { status: 'account', account: verified.account };
      }
      return { status: 'elsewhere' };
    }
  }
  return { status: 'nobody', token, session };
}

/**
 * Why a request nobody signed in made was refused, as what to do about it.
 * @param token - the token it sent, if any
 * @param session - the session cookie it sent, if any
 * @param context - the tokens taken
 * @returns the refusal
 */
export function refusalOf(
  token: string | undefined,
  session: string | undefined,
  context: SessionContext,
): AccountRefusal {
  if (token !== undefined) {
    const { adminToken, verifyToken } = context;
    return (adminToken === undefined || adminToken === '') &&
      verifyToken === undefined
      ? 'noAdminToken'
      : 'wrongToken';
  }
  if (session !== undefined) return 'sessionEnded';
  return 'signInRequired';
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
 * The token a request sends: an `Authorization: Bearer` header, else
 * `?token=` when the host takes it.
 * @param request - the request
 * @param fromQuery - whether `?token=` is read
 * @returns the token, or undefined without one
 */
function requestToken(
  request: FastifyRequest,
  fromQuery: boolean,
): string | undefined {
  const header = request.headers.authorization;
  if (header !== undefined) {
    return /^Bearer\s+(?<token>\S+)\s*$/i.exec(header)?.groups?.token;
  }
  if (!fromQuery) return undefined;
  const value = (request.query as Record<string, unknown> | undefined)?.token;
  return typeof value === 'string' && value !== '' ? value : undefined;
}
