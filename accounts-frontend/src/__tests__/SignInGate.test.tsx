// @vitest-environment jsdom
import { act } from 'react';
import { expect, test } from 'vitest';

import { SignInGate } from '../SignInGate.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';
import type { AccountRole } from '../rules.ts';

import { button, click, mount, type } from './dom.ts';
import { API, PASSWORD, fakeServer } from './fakeServer.ts';

/**
 * A site's session on a fake server, and the gate drawn in front of a page.
 * @param signedIn - Who is signed in at the start.
 * @param role - The role the page needs.
 * @returns The page and the server.
 */
async function gate(signedIn?: string, role?: AccountRole) {
  const server = fakeServer({ signedIn });
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  const host = await mount(
    <SignInGate
      store={store}
      role={role}
      title="Samples"
      note="Adding and correcting the samples."
    >
      <p data-testid="page">The samples</p>
    </SignInGate>,
  );
  return { host, server, store };
}

test('a browser signed in sees the page, after one question to the server', async () => {
  const { host, server } = await gate('max');

  expect(host.querySelector('[data-testid="page"]')?.textContent).toBe(
    'The samples',
  );
  expect(host.querySelector('[data-testid="sign-in"]')).toBeNull();
  expect(
    server.asked.map((each) => `${each.method} ${each.url}`),
  ).toStrictEqual(['GET /v1/account/session']);
});

test('a browser signed out is asked to sign in, and the form says what for', async () => {
  const { host } = await gate();

  const form = host.querySelector('[data-testid="sign-in"]');

  expect(form?.querySelector('h1')?.textContent).toBe('Samples');
  expect(form?.querySelector('.accounts-note')?.textContent).toBe(
    'Adding and correcting the samples.',
  );
  expect(
    [...(form?.querySelectorAll('label') ?? [])].map((label) =>
      label.textContent?.trim(),
    ),
  ).toStrictEqual(['Username', 'Password']);
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
    'The samples',
  );
  expect(server.asked.at(-1)).toStrictEqual({
    url: '/v1/account/login',
    method: 'POST',
    body: { username: 'luc', password: PASSWORD },
    credentials: 'same-origin',
  });
});

test('an account below the role of the page is told so, and can sign in as another', async () => {
  const { host, server } = await gate('max', 'admin');

  const refusal = host.querySelector('[data-testid="role-refusal"]');

  expect(refusal?.querySelector('[role="alert"]')?.textContent).toBe(
    'This page is for administrators, and max is not one.',
  );
  expect(host.querySelector('[data-testid="page"]')).toBeNull();

  await click(button(host, 'Sign in as somebody else'));

  expect(server.asked.at(-1)?.url).toBe('/v1/account/logout');
  expect(host.querySelector('[data-testid="sign-in"]')).not.toBeNull();
});

test('a reader is told a page that changes the data is not for it; a writer gets in', async () => {
  const reader = await gate('max', 'write');
  const writer = await gate('ada', 'write');

  expect(reader.host.querySelector('[role="alert"]')?.textContent).toBe(
    'This page changes the data, and max can only read it.',
  );
  expect(writer.host.querySelector('[data-testid="page"]')).not.toBeNull();
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
