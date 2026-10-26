import { expect, test } from 'vitest';

import { failureOf } from '../accountFailure.ts';
import {
  AccountsRequestError,
  asSentence,
  createAccountsClient,
  messageOf,
  sentenceOf,
} from '../accountsClient.ts';

import { LUC, NOBODY, fakeServer, refusal } from './fakeFetch.ts';

test('the client sends JSON with the cookie, never from a cache, and a refusal keeps its status and code', async () => {
  const { fetcher, asked } = fakeServer({
    'POST /v1/account/login': () => Response.json(LUC),
    'GET /v1/account/users': () =>
      refusal(
        403,
        'roleTooLow',
        'Your account cannot do this: ask an administrator.',
      ),
  });
  const client = createAccountsClient('/v1/account', fetcher);

  const session = await client.signIn('Luc', 'a password');
  const refused = await client.accounts().catch((error: unknown) => error);

  expect(session).toStrictEqual(LUC);
  expect(asked[0]).toStrictEqual({
    url: '/v1/account/login',
    method: 'POST',
    body: { username: 'Luc', password: 'a password' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(refused).toBeInstanceOf(AccountsRequestError);
  expect(failureOf(refused)).toStrictEqual({
    code: 'roleTooLow',
    status: 403,
    message: 'Your account cannot do this: ask an administrator.',
  });
});

test('every route is asked with its method, under the base path the site chose', async () => {
  const { fetcher, asked } = fakeServer({
    'POST /v1/admin/users': () => Response.json({ id: 4 }),
    'PATCH /v1/admin/users/4': () => Response.json({ id: 4 }),
    'DELETE /v1/admin/users/4': () => Response.json({ id: 4 }),
    'POST /v1/admin/password': () => Response.json(LUC),
    'POST /v1/admin/logout': () => Response.json(NOBODY),
  });
  const client = createAccountsClient('/v1/admin', fetcher);

  await client.addAccount('bob', 'his');
  await client.addAccount('dora', 'hers', 'write');
  await client.setRole(4, 'admin');
  await client.setPassword(4, 'a new one');
  await client.removeAccount(4);
  await client.changeOwnPassword('old', 'new');
  await client.signOut();

  expect(asked.map((each) => [each.method, each.url, each.body])).toStrictEqual(
    [
      [
        'POST',
        '/v1/admin/users',
        { username: 'bob', password: 'his', role: 'read' },
      ],
      [
        'POST',
        '/v1/admin/users',
        { username: 'dora', password: 'hers', role: 'write' },
      ],
      ['PATCH', '/v1/admin/users/4', { role: 'admin' }],
      ['PATCH', '/v1/admin/users/4', { password: 'a new one' }],
      ['DELETE', '/v1/admin/users/4', undefined],
      [
        'POST',
        '/v1/admin/password',
        { currentPassword: 'old', newPassword: 'new' },
      ],
      ['POST', '/v1/admin/logout', undefined],
    ],
  );
});

test('a refusal without a code keeps the server’s words, and an unknown code is none', async () => {
  await expect(
    messageOf(new Response('<html>busy</html>', { status: 503 })),
  ).resolves.toBe('the server answered 503');
  await expect(
    messageOf(Response.json({ message: '' }, { status: 500 })),
  ).resolves.toBe('the server answered 500');

  const { fetcher } = fakeServer({
    'POST /v1/account/users': () =>
      refusal(
        400,
        'FST_ERR_VALIDATION',
        'body/username must NOT have more than 30 characters',
      ),
  });
  const refused = await createAccountsClient('/v1/account', fetcher)
    .addAccount('l'.repeat(31), 'x')
    .catch((error: unknown) => error);

  expect(failureOf(refused)).toStrictEqual({
    code: undefined,
    status: 400,
    message: 'body/username must NOT have more than 30 characters',
  });
  expect(failureOf('nothing')).toStrictEqual({
    code: undefined,
    status: 0,
    message: 'the request failed',
  });
});

test('a message becomes a sentence', () => {
  expect(sentenceOf(new Error('the server answered 500'))).toBe(
    'The server answered 500.',
  );
  expect(sentenceOf(new Error('Done!'))).toBe('Done!');
  expect(sentenceOf('nothing')).toBe('The request failed.');
  expect(asSentence('body/username must NOT be empty')).toBe(
    'Body/username must NOT be empty.',
  );
  expect(asSentence('  ')).toBe('');
});
