// @vitest-environment jsdom
import { expect, test } from 'vitest';

import { page, routes, rows } from './accountsPageFixture.tsx';
import { button, click, field, required, type } from './dom.ts';
import { PASSWORD } from './fakeServer.ts';

test('an account is added with the role picked, and a name taken is refused', async () => {
  const { host, server } = await page();
  const form = required(
    host.querySelector<HTMLElement>('[data-testid="add-account"]'),
    'form to add an account',
  );

  await type(field(form, 'Username'), ' Bob ');
  await type(field(form, 'Password'), 'his password');
  await type(field(form, 'Role'), 'write');
  await click(button(form, 'Add the account'));
  const added = form.textContent;

  await type(field(form, 'Username'), 'ada');
  await type(field(form, 'Password'), 'another');
  await click(button(form, 'Add the account'));
  const taken = form.querySelector('[role="alert"]')?.textContent;

  await type(field(form, 'Username'), 'x');
  await click(button(form, 'Add the account'));

  expect(added).toContain('bob can sign in now.');
  expect(rows(host).map((row) => row.slice(0, 2))).toStrictEqual([
    ['ada', '[write]'],
    ['bob', '[write]'],
    ['lucyou', 'Administrator'],
    ['max', '[read]'],
  ]);
  expect(
    server.asked.find((each) => each.method === 'POST')?.body,
  ).toStrictEqual({ username: 'Bob', password: 'his password', role: 'write' });
  expect(taken).toBe('That username is taken.');
  // Too short is said before anything is sent.
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    'A username has 3 to 30 characters.',
  );
  expect(server.asked.filter((each) => each.method === 'POST')).toHaveLength(2);
});

test('your own password changes with the current one and the new one twice', async () => {
  const { host } = await page();
  const form = required(
    host.querySelector<HTMLElement>('[data-testid="change-password"]'),
    'form to change the password',
  );

  await type(field(form, 'Current password'), PASSWORD);
  await type(field(form, 'New password'), 'one');
  await type(field(form, 'New password, again'), 'two');
  await click(button(form, 'Change your password'));
  const differ = form.querySelector('[role="alert"]')?.textContent;

  await type(field(form, 'Current password'), 'not it');
  await type(field(form, 'New password, again'), 'one');
  await click(button(form, 'Change your password'));
  const wrong = form.querySelector('[role="alert"]')?.textContent;

  await type(field(form, 'Current password'), PASSWORD);
  await click(button(form, 'Change your password'));

  expect(differ).toBe('The two new passwords differ.');
  expect(wrong).toBe('The current password is not that one.');
  expect(form.textContent).toContain(
    'Your password is changed. Other browsers signed in as you are signed out.',
  );
  expect(field(form, 'Current password').value).toBe('');
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

  await type(field(dialog, 'New password'), 'a new one');
  await type(field(dialog, 'New password, again'), 'a new one');
  await click(button(dialog, 'Set the password'));

  expect(title).toBe('Set the password of ada');
  expect(routes(server).slice(-2)).toStrictEqual([
    'PATCH /v1/account/users/1',
    'GET /v1/account/users',
  ]);
  expect(server.asked.at(-2)?.body).toStrictEqual({ password: 'a new one' });
  expect(document.querySelector('[data-testid="set-password"]')).toBeNull();
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
    'DELETE /v1/account/users/1',
    'GET /v1/account/users',
  ]);
  expect(rows(host).map((row) => row[0])).toStrictEqual(['lucyou', 'max']);
});
