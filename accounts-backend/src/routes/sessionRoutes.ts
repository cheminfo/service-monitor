import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AccountsContext } from '../guard.ts';
import { sessionCookie } from '../guard.ts';
import { isSameOrigin } from '../isSameOrigin.ts';
import { refuse } from '../refuse.ts';
import { MAX_PASSWORD_LENGTH, REFUSAL_MESSAGES } from '../rules.ts';
import { SESSION_SECONDS, shouldRenew } from '../sessions.ts';
import { checkSignIn } from '../signIn.ts';
import type { AccountRow } from '../store/AccountStore.ts';
import type { AccountSession, SignInBody } from '../types.ts';

import { documented } from './documented.ts';
import { SESSION_SCHEMA } from './schemas.ts';

/**
 * Sign in and out, and say whether this browser is.
 *
 * These routes are open to everybody, so they sit beside the guarded routes
 * rather than behind their hook. Signing in and out is taken from this site's
 * own pages only: another site cannot use its visitors' browsers to guess a
 * password from a thousand addresses.
 * @param fastify - the scope, with cookies and the rate limit registered
 * @param context - the accounts and the sessions
 * @param signInLimit - how many sign-ins one client may try per fifteen minutes
 */
export function sessionRoutes(
  fastify: FastifyInstance,
  context: AccountsContext,
  signInLimit: number,
): void {
  fastify.get(
    '/session',
    {
      schema: documented({
        summary: 'Whether this browser is signed in',
        description:
          'A session signed in more than a day ago comes back with a new cookie, valid for 400 days again: somebody who keeps coming back is never asked to sign in again.',
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      const store = await context.store();
      const session = await context.sessions.verify(
        sessionCookie(request, context.cookieName),
        (id) => store.byId(id),
      );
      if (session !== null && shouldRenew(session)) {
        return sendSession(request, reply, context, session.account);
      }
      return reply
        .header('cache-control', 'no-store')
        .send(sessionOf(session?.account ?? null));
    },
  );

  fastify.post<{ Body: SignInBody }>(
    '/login',
    {
      config: {
        rateLimit: {
          max: signInLimit,
          timeWindow: '15 minutes',
          errorResponseBuilder: tooManyAttempts,
        },
      },
      schema: documented({
        summary: 'Sign in',
        description: `Checks the username and password of an account, and answers with a session cookie that lasts 400 days. ${signInLimit} attempts per client every 15 minutes.`,
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 256 },
            password: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_PASSWORD_LENGTH,
            },
          },
        },
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (!isSameOrigin(request)) return refuse(reply, 403, 'signInElsewhere');
      const { username, password } = request.body;
      const account = await checkSignIn(
        await context.store(),
        username,
        password,
      );
      if (account === null) {
        request.log.warn(
          { clientIp: request.ip, username },
          'refused a sign-in',
        );
        return refuse(reply, 401, 'wrongCredentials');
      }
      request.log.info(
        { clientIp: request.ip, username: account.username },
        'signed in',
      );
      return sendSession(request, reply, context, account);
    },
  );

  fastify.post(
    '/logout',
    {
      schema: documented({
        summary: 'Sign this browser out',
        description:
          'Clears the session cookie. A session is not kept on the server, so a copy of the cookie taken elsewhere lasts until it expires; a new password, or COOKIE_SECRET changed, ends them all.',
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (!isSameOrigin(request)) return refuse(reply, 403, 'signOutElsewhere');
      return reply
        .clearCookie(context.cookieName, cookieAttributes(request))
        .header('cache-control', 'no-store')
        .send(sessionOf(null));
    },
  );
}

/**
 * Open a session for an account, and answer with it.
 * @param request - the request being answered
 * @param reply - where the cookie and the answer go
 * @param context - what opens sessions, and the cookie they are kept in
 * @param account - the account signed in
 * @returns the reply, sent
 */
export async function sendSession(
  request: FastifyRequest,
  reply: FastifyReply,
  context: AccountsContext,
  account: AccountRow,
): Promise<FastifyReply> {
  return reply
    .setCookie(context.cookieName, await context.sessions.open(account), {
      ...cookieAttributes(request),
      maxAge: SESSION_SECONDS,
    })
    .header('cache-control', 'no-store')
    .send(sessionOf(account));
}

/**
 * The attributes the session cookie is set and cleared with: never readable
 * by a script, never sent from another site, and only over HTTPS when the page
 * came over it — behind a proxy, only once the host trusts it.
 * @param request - the request being answered
 * @returns the attributes
 */
function cookieAttributes(request: FastifyRequest) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: request.protocol === 'https',
  };
}

/**
 * Where this browser stands, as every route here answers it.
 * @param account - the account signed in, or null
 * @returns the answer
 */
function sessionOf(account: AccountRow | null): AccountSession {
  return {
    signedIn: account !== null,
    username: account?.username ?? null,
    role: account?.role ?? null,
  };
}

/**
 * The refusal of a client that tried too many sign-ins: thrown by the rate
 * limit, and answered by Fastify with the code beside the message.
 * @returns the error
 */
function tooManyAttempts(): Error {
  return Object.assign(new Error(REFUSAL_MESSAGES.tooManyAttempts), {
    statusCode: 429,
    code: 'tooManyAttempts',
  });
}
