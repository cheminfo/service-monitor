// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';

import { AccountMenu } from '../AccountMenu.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { click, mount, settle } from './dom.ts';
import { API, fakeServer } from './fakeServer.ts';

/**
 * The account menu, on a session already read from a fake server.
 * @param signedIn - Who is signed in, if anybody.
 * @returns The bar entry, the server, and what the menu called.
 */
async function menu(signedIn?: string) {
  const server = fakeServer({ signedIn });
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  await store.load();
  const onSignedOut = vi.fn();
  const onAccounts = vi.fn();
  const host = await mount(
    <AccountMenu
      store={store}
      onSignedOut={onSignedOut}
      items={[{ id: 'password', label: 'Your password', href: '/password' }]}
      adminItems={[
        {
          id: 'accounts',
          label: 'Accounts',
          href: '/accounts',
          onSelect: onAccounts,
        },
      ]}
    />,
  );
  return { host, server, store, onSignedOut, onAccounts };
}

/**
 * The items of the menu the account opens, in their order.
 * @returns Their text.
 */
function menuItems(): string[] {
  return [...document.querySelectorAll('.account-menu .bp6-menu-item')].map(
    (item) => item.textContent?.trim() ?? '',
  );
}

test('nobody signed in, the bar shows no account at all', async () => {
  const { host } = await menu();

  expect(host.innerHTML).toBe('');
});

test('an administrator opens its name, its role, its pages, the admin pages and Sign out', async () => {
  const { host, onAccounts } = await menu('luc');

  const trigger = host.querySelector('button.account-button');

  expect(trigger?.getAttribute('title')).toBe('Signed in as luc');
  expect(trigger?.textContent).toBe('LU');

  await click(trigger);

  expect([
    document.querySelector('.account-menu__name')?.textContent,
    document.querySelector('.account-menu__detail')?.textContent,
  ]).toStrictEqual(['luc', 'Administrator']);
  expect(menuItems()).toStrictEqual(['Your password', 'Accounts', 'Sign out']);

  await click(document.querySelector('.account-menu a[href="/accounts"]'));

  expect(onAccounts).toHaveBeenCalledOnce();
});

test('an account that is not an administrator sees no admin page', async () => {
  const { host } = await menu('ada');

  await click(host.querySelector('button.account-button'));

  expect(document.querySelector('.account-menu__detail')?.textContent).toBe(
    'Read and write',
  );
  expect(menuItems()).toStrictEqual(['Your password', 'Sign out']);
});

test('signing out asks the server, empties the bar and tells the site', async () => {
  const { host, server, onSignedOut } = await menu('luc');

  await click(host.querySelector('button.account-button'));
  const signOut = [
    ...document.querySelectorAll('.account-menu .bp6-menu-item'),
  ].find((item) => item.textContent?.trim() === 'Sign out');
  await click(signOut);
  await settle();

  expect(server.asked.at(-1)?.url).toBe('/v1/account/logout');
  expect(host.querySelector('.account-button')).toBeNull();
  expect(onSignedOut).toHaveBeenCalledOnce();
});
