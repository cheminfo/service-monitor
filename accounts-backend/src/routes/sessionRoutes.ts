import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { MAX_PASSWORD_LENGTH, checkSignIn } from '../accounts.ts';
import type { AccountsContext } from '../guard.ts';
import { sessionCookie } from '../guard.ts';
import { isSameOrigin } from '../isSameOrigin.ts';
import { SESSION_SECONDS } from '../sessions.ts';
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
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      const store = await context.store();
      const account = await context.sessions.verify(
        sessionCookie(request, context.cookieName),
        (id) => store.byId(id),
      );
      return reply.header('cache-control', 'no-store').send(sessionOf(account));
    },
  );

  fastify.post<{ Body: SignInBody }>(
    '/login',
    {
      config: { rateLimit: { max: signInLimit, timeWindow: '15 minutes' } },
      schema: documented({
        summary: 'Sign in',
        description: `Checks the username and password of an account, and answers with a session cookie that lasts 8 hours. ${signInLimit} attempts per client every 15 minutes.`,
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
      if (!isSameOrigin(request)) {
        return refuse(
          reply,
          403,
          'signing in happens on this site’s own pages',
        );
      }
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
        return refuse(reply, 401, 'wrong username or password');
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
      if (!isSameOrigin(request)) {
        return refuse(
          reply,
          403,
          'signing out happens on this site’s own pages',
        );
      }
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
 * Answer with a refusal, in the shape every route refuses with.
 * @param reply - where it goes
 * @param statusCode - 400, 401, 403 or 404
 * @param message - why, in lower case, to be quoted
 * @returns the reply, sent
 */
export function refuse(
  reply: FastifyReply,
  statusCode: 400 | 401 | 403 | 404,
  message: string,
): FastifyReply {
  const error = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
  }[statusCode];
  return reply.code(statusCode).send({ statusCode, error, message });
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
  return { signedIn: account !== null, username: account?.username ?? null };
}
