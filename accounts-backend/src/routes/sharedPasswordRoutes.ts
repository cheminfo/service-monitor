import type { FastifyInstance } from 'fastify';

import type { SessionContext } from '../guard.ts';
import { isSameOrigin } from '../isSameOrigin.ts';
import { refuse } from '../refuse.ts';
import type { AccountRow } from '../store/AccountStore.ts';
import type { ChangePasswordBody, PasswordSignInBody } from '../types.ts';

import { documented } from './documented.ts';
import { PASSWORD_SCHEMA, SESSION_SCHEMA, SESSION_SCHEME } from './schemas.ts';
import { sendSession, signInRateLimit } from './sessionRoutes.ts';

/** Checks a password typed against the shared one. */
export type SharedPasswordCheck = (
  password: string,
) => Promise<AccountRow | null>;

/**
 * The route that signs in with the shared password, open to everybody and
 * taken from this site's own pages only.
 * @param fastify - the scope, with cookies and the rate limit registered
 * @param context - the sessions
 * @param signInLimit - how many sign-ins one client may try per fifteen minutes
 * @param check - checks the password typed
 */
export function sharedPasswordSignInRoute(
  fastify: FastifyInstance,
  context: SessionContext,
  signInLimit: number,
  check: SharedPasswordCheck,
): void {
  fastify.post<{ Body: PasswordSignInBody }>(
    '/login',
    {
      config: signInRateLimit(signInLimit),
      schema: documented({
        summary: 'Sign in',
        description: `Checks the shared password, and answers with a session cookie that lasts 400 days. ${signInLimit} attempts per client every 15 minutes.`,
        body: {
          type: 'object',
          required: ['password'],
          additionalProperties: false,
          properties: { password: PASSWORD_SCHEMA },
        },
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (!isSameOrigin(request)) return refuse(reply, 403, 'signInElsewhere');
      const account = await check(request.body.password);
      if (account === null) {
        request.log.warn({ clientIp: request.ip }, 'refused a sign-in');
        return refuse(reply, 401, 'wrongCredentials');
      }
      request.log.info({ clientIp: request.ip }, 'signed in');
      return sendSession(request, reply, context, account);
    },
  );
}

/**
 * The route that changes the shared password. Registered behind the guard.
 * @param fastify - the guarded scope
 * @param context - what opens the new session
 * @param check - checks the current password
 * @param change - keeps the new password, and answers the account it signs in
 */
export function sharedPasswordChangeRoute(
  fastify: FastifyInstance,
  context: SessionContext,
  check: SharedPasswordCheck,
  change: (password: string) => Promise<AccountRow>,
): void {
  fastify.post<{ Body: ChangePasswordBody }>(
    '/password',
    {
      schema: documented({
        security: [{ [SESSION_SCHEME]: [] }],
        summary: 'Change the shared password',
        description:
          'Ends every other session, and answers with a new one for this browser.',
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          additionalProperties: false,
          properties: {
            currentPassword: PASSWORD_SCHEMA,
            newPassword: PASSWORD_SCHEMA,
          },
        },
        response: { 200: SESSION_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (request.signedInAccount === null) {
        return refuse(reply, 400, 'tokenCannotChangePassword');
      }
      const { currentPassword, newPassword } = request.body;
      if ((await check(currentPassword)) === null) {
        return refuse(reply, 400, 'wrongCurrentPassword');
      }
      const account = await change(newPassword);
      request.log.info({ clientIp: request.ip }, 'changed the shared password');
      return sendSession(request, reply, context, account);
    },
  );
}
