// @vitest-environment jsdom
import { act } from 'react';
import { expect, test } from 'vitest';

import { SignInGate } from '../SignInGate.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { button, click, mount, type } from './dom.ts';
import { PASSWORD, fakeServer } from './fakeServer.ts';

/**
 * A site's session on a fake server, and the gate drawn in front of a page.
 * @param signedIn - who is signed in at the start
 * @returns the page and the server
 */
async function gate(signedIn?: string) {
  const server = fakeServer({ signedIn });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', server.fetcher),
  );
  const host = await mount(
    <SignInGate
      store={store}
      title="Operators"
      note="The imports and the logs."
    >
      <p data-testid="page">The status</p>
    </SignInGate>,
  );
  return { host, server, store };
}

test('a browser signed in sees the page, after one question to the server', async () => {
  const { host, server } = await gate('luc');

  expect(host.querySelector('[data-testid="page"]')?.textContent).toBe(
    'The status',
  );
  expect(host.querySelector('[data-testid="sign-in"]')).toBeNull();
  expect(
    server.asked.map((each) => `${each.method} ${each.url}`),
  ).toStrictEqual(['GET /v1/admin/session']);
});

test('a browser signed out is asked to sign in, and the form says what for', async () => {
  const { host } = await gate();

  const form = host.querySelector('[data-testid="sign-in"]');

  expect(form?.querySelector('h1')?.textContent).toBe('Operators');
  expect(form?.querySelector('.accounts-note')?.textContent).toBe(
    'The imports and the logs.',
  );
  expect(button(host, 'Sign in').disabled).toBe(true);
  expect(host.querySelector('[data-testid="page"]')).toBeNull();
});

test('a wrong password is said in the form, and the right one opens the page', async () => {
  const { host, server } = await gate();

  await type(host.querySelector('#accounts-username'), 'luc');
  await type(host.querySelector('#accounts-password'), 'a guess');
  await click(button(host, 'Sign in'));
  const refusal = host.querySelector('[role="alert"]')?.textContent;
  const cleared =
    host.querySelector<HTMLInputElement>('#accounts-password')?.value;

  await type(host.querySelector('#accounts-password'), PASSWORD);
  await click(button(host, 'Sign in'));

  expect(refusal).toBe('Wrong username or password.');
  expect(cleared).toBe('');
  expect(host.querySelector('[data-testid="page"]')?.textContent).toBe(
    'The status',
  );
  expect(server.asked.at(-1)).toStrictEqual({
    url: '/v1/admin/login',
    method: 'POST',
    body: { username: 'luc', password: PASSWORD },
    credentials: 'same-origin',
  });
});

test('a session refused elsewhere brings the form back, saying why', async () => {
  const { host, store } = await gate('luc');

  // The server forgets the session, and the next request of any page is
  // refused.
  await act(async () => {
    await store.client.signOut();
    await store.attempt(() => store.client.accounts());
  });

  expect(host.querySelector('[data-testid="page"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'The session has ended: sign in again.',
  );
});
