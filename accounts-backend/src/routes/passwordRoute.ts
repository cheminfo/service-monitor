import type { FastifyInstance } from 'fastify';

import { setAccountPassword } from '../accounts.ts';
import type { AccountsContext } from '../guard.ts';
import { verifyPassword } from '../password.ts';
import { refuse, refuseAccountError } from '../refuse.ts';
import type { AccountRow } from '../store/AccountStore.ts';
import type { ChangePasswordBody } from '../types.ts';

import { documented } from './documented.ts';
import { PASSWORD_SCHEMA, SESSION_SCHEMA, SESSION_SCHEME } from './schemas.ts';
import { sendSession } from './sessionRoutes.ts';

/**
 * The route that changes the password of the account signed in, which every
 * account reaches whatever its role. Registered behind the guard.
 * @param fastify - the guarded scope
 * @param context - the accounts, and what opens the new session
 */
export function passwordRoute(
  fastify: FastifyInstance,
  context: AccountsContext,
): void {
  fastify.post<{ Body: ChangePasswordBody }>(
    '/password',
    {
      schema: documented({
        security: [{ [SESSION_SCHEME]: [] }],
        summary: 'Change the password of the account signed in',
        description:
          'Every account may. Ends every other session of the account, and answers with a new one for this browser. The account ADMIN_USERNAME defines changes its password in .env instead.',
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
      const signedIn = request.signedInAccount;
      if (signedIn === null) {
        return refuse(reply, 400, 'tokenCannotChangePassword');
      }
      if (signedIn.envManaged) return refuse(reply, 400, 'envManaged');
      const { currentPassword, newPassword } = request.body;
      if (!(await verifyPassword(currentPassword, signedIn.passwordHash))) {
        return refuse(reply, 400, 'wrongCurrentPassword');
      }
      let account: AccountRow | undefined;
      try {
        account = await setAccountPassword(
          await context.store(),
          signedIn.id,
          newPassword,
        );
      } catch (error: unknown) {
        return refuseAccountError(reply, error);
      }
      if (account === undefined) return refuse(reply, 404, 'accountRemoved');
      request.log.info({ username: account.username }, 'changed its password');
      return sendSession(request, reply, context, account);
    },
  );
}
