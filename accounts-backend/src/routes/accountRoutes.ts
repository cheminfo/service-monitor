import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createAccount, removeAccount, updateAccount } from '../accounts.ts';
import type { AccountsContext } from '../guard.ts';
import { refuse, refuseAccountError } from '../refuse.ts';
import { toAccount } from '../signIn.ts';
import type { AccountRow } from '../store/AccountStore.ts';
import type { AccountPatchBody, NewAccountBody } from '../types.ts';

import { documented } from './documented.ts';
import {
  ACCOUNT_SCHEMA,
  ID_PARAMS_SCHEMA,
  PASSWORD_SCHEMA,
  ROLE_SCHEMA,
  USERNAME_SCHEMA,
} from './schemas.ts';

/** What only an administrator asks for: managing the accounts. */
const ADMIN_ONLY = { accountRole: 'admin' } as const;

/**
 * The routes that list, add, change and remove the accounts, which only an
 * administrator, or the operator's token, reaches. Registered behind the
 * guard.
 * @param fastify - the guarded scope
 * @param context - the accounts
 */
export function accountRoutes(
  fastify: FastifyInstance,
  context: AccountsContext,
): void {
  fastify.get(
    '/users',
    {
      config: ADMIN_ONLY,
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
      config: ADMIN_ONLY,
      schema: documented({
        summary: 'Add an account',
        description: 'Without a role, the account only reads.',
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: {
            username: USERNAME_SCHEMA,
            password: PASSWORD_SCHEMA,
            role: ROLE_SCHEMA,
          },
        },
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      let account: AccountRow;
      try {
        account = await createAccount(await context.store(), request.body);
      } catch (error: unknown) {
        return refuseAccountError(reply, error);
      }
      request.log.info(
        { by: actor(request), username: account.username, role: account.role },
        'added an account',
      );
      return toAccount(account);
    },
  );

  fastify.patch<{ Params: { id: number }; Body: AccountPatchBody }>(
    '/users/:id',
    {
      config: ADMIN_ONLY,
      schema: documented({
        summary: "Change another account's password, its role, or both",
        description:
          'A new password ends every session of that account; a new role applies at its next request. Neither the last administrator nor the account ADMIN_USERNAME defines is demoted, and your own password is changed with POST /password, which asks for the current one.',
        params: ID_PARAMS_SCHEMA,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { password: PASSWORD_SCHEMA, role: ROLE_SCHEMA },
        },
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      const { id } = request.params;
      const { password, role } = request.body;
      if (password === undefined && role === undefined) {
        return refuse(reply, 400, 'nothingToChange');
      }
      if (id === request.signedInAccount?.id) {
        return refuse(
          reply,
          400,
          password === undefined ? 'ownRole' : 'useChangePassword',
        );
      }
      let account: AccountRow | undefined;
      try {
        account = await updateAccount(await context.store(), id, {
          password,
          role,
        });
      } catch (error: unknown) {
        return refuseAccountError(reply, error);
      }
      if (account === undefined) return refuse(reply, 404, 'noSuchAccount');
      request.log.info(
        {
          by: actor(request),
          username: account.username,
          password: password !== undefined,
          role,
        },
        'changed an account',
      );
      return toAccount(account);
    },
  );

  fastify.delete<{ Params: { id: number } }>(
    '/users/:id',
    {
      config: ADMIN_ONLY,
      schema: documented({
        summary: 'Remove an account',
        description:
          'Neither your own account, the last administrator nor the one ADMIN_USERNAME defines is removed: somebody must still be able to manage the accounts.',
        params: ID_PARAMS_SCHEMA,
        response: { 200: ACCOUNT_SCHEMA },
      }),
    },
    async (request, reply) => {
      const { id } = request.params;
      if (id === request.signedInAccount?.id) {
        return refuse(reply, 400, 'removeYourself');
      }
      const store = await context.store();
      const account = store.byId(id);
      const outcome = removeAccount(store, id);
      if (outcome === 'missing' || account === undefined) {
        return refuse(reply, 404, 'noSuchAccount');
      }
      if (outcome !== 'removed') return refuse(reply, 400, outcome);
      request.log.info(
        { by: actor(request), username: account.username },
        'removed an account',
      );
      return toAccount(account);
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
