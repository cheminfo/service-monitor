// @vitest-environment jsdom
import { expect, onTestFinished, test, vi } from 'vitest';

import { AccountsPage } from '../AccountsPage.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { button, click, mount, required, type } from './dom.ts';
import { PASSWORD, fakeServer } from './fakeServer.ts';

/**
 * The Accounts page, signed in as luc on a fake server.
 * @param signedIn - who is signed in, or null for nobody
 * @returns the page, the server and the session
 */
async function page(signedIn: string | null = 'luc') {
  const server = fakeServer({ signedIn: signedIn ?? undefined });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', server.fetcher),
  );
  await store.load();
  const host = await mount(<AccountsPage store={store} />);
  return { host, server, store };
}

/**
 * The cells of each row of the accounts table.
 * @param host - the page
 * @returns their text, row by row
 */
function rows(host: HTMLElement): string[][] {
  return [
    ...host.querySelectorAll('[data-testid="accounts-table"] tbody tr'),
  ].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );
}

/**
 * The methods and routes the server was asked, in order.
 * @param server - the fake server
 * @returns `METHOD url`, one per request
 */
function routes(server: ReturnType<typeof fakeServer>): string[] {
  return server.asked.map((each) => `${each.method} ${each.url}`);
}

test('the accounts are listed, yours marked, the others with what can be done', async () => {
  // luc last signed in at 13:00: two hours before now.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T15:00:00Z'));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { host } = await page();

  expect(rows(host)).toStrictEqual([
    ['ada', '2026-10-02', 'never', '2026-10-02', 'Set passwordRemove'],
    ['lucyou', '2026-10-02', '2 hours ago', '2026-10-02', ''],
  ]);
  expect(
    host
      .querySelector('[data-testid="account-luc"] time')
      ?.getAttribute('title'),
  ).toBe('2026-10-02 12:00 UTC');
});

test('an account is added and listed, and a name taken is refused', async () => {
  const { host, server } = await page();
  const form = required(
    host.querySelector<HTMLElement>('[data-testid="add-account"]'),
    'form to add an account',
  );

  await type(host.querySelector('#account-username'), ' Bob ');
  await type(host.querySelector('#account-password'), 'his password');
  await click(button(form, 'Add the account'));
  const added = form.textContent;

  await type(host.querySelector('#account-username'), 'ada');
  await type(host.querySelector('#account-password'), 'another');
  await click(button(form, 'Add the account'));

  expect(added).toContain('bob can sign in now.');
  expect(rows(host).map((row) => row[0])).toStrictEqual([
    'ada',
    'bob',
    'lucyou',
  ]);
  expect(
    server.asked.find((each) => each.method === 'POST')?.body,
  ).toStrictEqual({
    username: 'Bob',
    password: 'his password',
  });
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    'There is already an account named ada.',
  );
});

test('your own password changes with the current one and the new one twice', async () => {
  const { host } = await page();
  const form = required(
    host.querySelector<HTMLElement>('[data-testid="change-password"]'),
    'form to change the password',
  );

  await type(host.querySelector('#current-password'), PASSWORD);
  await type(host.querySelector('#new-password'), 'one');
  await type(host.querySelector('#new-password-repeat'), 'two');
  await click(button(form, 'Change your password'));
  const differ = form.querySelector('[role="alert"]')?.textContent;

  await type(host.querySelector('#current-password'), 'not it');
  await type(host.querySelector('#new-password-repeat'), 'one');
  await click(button(form, 'Change your password'));
  const wrong = form.querySelector('[role="alert"]')?.textContent;

  await type(host.querySelector('#current-password'), PASSWORD);
  await click(button(form, 'Change your password'));

  expect(differ).toBe('The two new passwords differ.');
  expect(wrong).toBe('The current password is not that one.');
  expect(form.textContent).toContain(
    'Your password is changed. Other browsers signed in as you are signed out.',
  );
  expect(host.querySelector<HTMLInputElement>('#current-password')?.value).toBe(
    '',
  );
});

test("another account's password is set in a dialog, which then closes", async () => {
  const { host, server } = await page();

  await click(
    button(
      host.querySelector('[data-testid="account-ada"]') ?? host,
      'Set password',
    ),
  );
  const dialog = required(
    document.querySelector<HTMLElement>('[data-testid="set-password"]'),
    'dialog setting the password',
  );
  const title = document.querySelector('.bp6-dialog-header')?.textContent;

  await type(dialog.querySelector('#set-password'), 'a new one');
  await type(dialog.querySelector('#set-password-repeat'), 'a new one');
  await click(button(dialog, 'Set the password'));

  expect(title).toBe('Set the password of ada');
  expect(routes(server).slice(-2)).toStrictEqual([
    'PATCH /v1/admin/users/1',
    'GET /v1/admin/users',
  ]);
  expect(server.asked.at(-2)?.body).toStrictEqual({ password: 'a new one' });
});

test('an account is removed once the alert is confirmed', async () => {
  const { host, server } = await page();

  await click(
    button(host.querySelector('[data-testid="account-ada"]') ?? host, 'Remove'),
  );
  const alert = required(
    document.querySelector<HTMLElement>('.bp6-alert'),
    'alert asking to remove',
  );
  const question = alert.querySelector('.bp6-alert-contents')?.textContent;
  await click(button(alert, 'Remove'));

  expect(question).toBe('Remove ada? It can no longer sign in.');
  expect(routes(server).slice(-2)).toStrictEqual([
    'DELETE /v1/admin/users/1',
    'GET /v1/admin/users',
  ]);
  expect(rows(host).map((row) => row[0])).toStrictEqual(['lucyou']);
});

test('a session that ended says so on the page, and lists nothing', async () => {
  const { host, store } = await page(null);

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'The session has ended: sign in again.',
  );
  expect(host.querySelector('[data-testid="accounts-table"]')).toBeNull();
  expect(host.querySelector('.bp6-spinner')).toBeNull();
  expect(store.get().notice).toBe('The session has ended: sign in again.');
});
