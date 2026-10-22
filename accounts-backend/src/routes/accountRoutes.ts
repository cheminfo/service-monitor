import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  AccountError,
  createAccount,
  removeAccount,
  setAccountPassword,
  toAccount,
} from '../accounts.ts';
import type { AccountsContext } from '../guard.ts';
import { verifyPassword } from '../password.ts';
import type { AccountRow } from '../store/AccountStore.ts';
import type {
  ChangePasswordBody,
  NewAccountBody,
  SetPasswordBody,
} from '../types.ts';

import { documented } from './documented.ts';
import {
  ACCOUNT_SCHEMA,
  ID_PARAMS_SCHEMA,
  PASSWORD_SCHEMA,
  SESSION_SCHEMA,
  SESSION_SCHEME,
  USERNAME_SCHEMA,
} from './schemas.ts';
import { refuse, sendSession } from './sessionRoutes.ts';

/**
 * The routes that list, add and remove the accounts, and change their
 * passwords. Every account may do everything: the list is there so the work
 * is shared, not to grade it. Registered behind the guard.
 * @param fastify - the guarded scope
 * @param context - the accounts, and what opens a session once a password
 * changed
 */
export function accountRoutes(
  fastify: FastifyInstance,
  context: AccountsContext,
): void {
  fastify.get(
    '/users',
    {
      schema: documented({
        summary: 'Every account that signs in here',
        response: {
          200: {
            type: 'object',
            required: ['users'],
            properties: { users: { type: 'array', items: ACCOUNT_SCHEMA } },
          },
        },
      }),
    },
    async () => {
      const store = await context.store();
      return { users: store.all().map(toAccount) };
    },
  );

  fastify.post<{ Body: NewAccountBody }>(
    '/users',
    {
      schema: documented({
        summary: 'Add an account',
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: { username: USERNAME_SCHEMA, password: PASSWORD_SCHEMA },
        },
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      let account: AccountRow;
      try {
        account = await createAccount(await context.store(), request.body);
      } catch (error: unknown) {
        if (error instanceof AccountError) {
          return refuse(reply, 400, error.message);
        }
        throw error;
      }
      request.log.info(
        { by: actor(request), username: account.username },
        'added an account',
      );
      return toAccount(account);
    },
  );

  fastify.patch<{ Params: { id: number }; Body: SetPasswordBody }>(
    '/users/:id',
    {
      schema: documented({
        summary: "Set another account's password",
        description:
          'Ends every session of that account. Your own password is changed with POST /password, which asks for the current one.',
        params: ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          required: ['password'],
          additionalProperties: false,
          properties: { password: PASSWORD_SCHEMA },
        },
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (request.params.id === request.signedInAccount?.id) {
        return refuse(
          reply,
          400,
          'change your own password with POST /password, which asks for the current one',
        );
      }
      let account: AccountRow | undefined;
      try {
        account = await setAccountPassword(
          await context.store(),
          request.params.id,
          request.body.password,
        );
      } catch (error: unknown) {
        if (error instanceof AccountError) {
          return refuse(reply, 400, error.message);
        }
        throw error;
      }
      if (account === undefined) {
        return refuse(reply, 404, `there is no account ${request.params.id}`);
      }
      request.log.info(
        { by: actor(request), username: account.username },
        'set the password of an account',
      );
      return toAccount(account);
    },
  );

  fastify.delete<{ Params: { id: number } }>(
    '/users/:id',
    {
      schema: documented({
        summary: 'Remove an account',
        description:
          'Neither your own account nor the last one is removed: somebody must still be able to sign in.',
        params: ID_PARAMS_SCHEMA,
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      if (request.params.id === request.signedInAccount?.id) {
        return refuse(
          reply,
          400,
          'you cannot remove the account you are using',
        );
      }
      const store = await context.store();
      const account = store.byId(request.params.id);
      const outcome = removeAccount(store, request.params.id);
      if (outcome === 'missing' || account === undefined) {
        return refuse(reply, 404, `there is no account ${request.params.id}`);
      }
      if (outcome === 'last') {
        return refuse(reply, 400, 'the last account cannot be removed');
      }
      request.log.info(
        { by: actor(request), username: account.username },
        'removed an account',
      );
      return toAccount(account);
    },
  );

  fastify.post<{ Body: ChangePasswordBody }>(
    '/password',
    {
      schema: documented({
        security: [{ [SESSION_SCHEME]: [] }],
        summary: 'Change the password of the account signed in',
        description:
          'Ends every other session of the account, and answers with a new one for this browser.',
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
        return refuse(
          reply,
          400,
          'a password is changed by the account signed in, not with the ADMIN_TOKEN',
        );
      }
      const { currentPassword, newPassword } = request.body;
      if (!(await verifyPassword(currentPassword, signedIn.passwordHash))) {
        return refuse(reply, 400, 'the current password is not that one');
      }
      let account: AccountRow | undefined;
      try {
        account = await setAccountPassword(
          await context.store(),
          signedIn.id,
          newPassword,
        );
      } catch (error: unknown) {
        if (error instanceof AccountError) {
          return refuse(reply, 400, error.message);
        }
        throw error;
      }
      if (account === undefined) {
        return refuse(reply, 404, 'the account signed in was removed');
      }
      request.log.info({ username: account.username }, 'changed its password');
      return sendSession(request, reply, context, account);
    },
  );
}

/**
 * Who made a change, as the log names them.
 * @param request - the request making it
 * @returns the account signed in, or the operator's token
 */
function actor(request: FastifyRequest): string {
  return request.signedInAccount?.username ?? 'ADMIN_TOKEN';
}
