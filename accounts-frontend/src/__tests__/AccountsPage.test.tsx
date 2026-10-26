// @vitest-environment jsdom
import { expect, onTestFinished, test, vi } from 'vitest';

import { page, routes, rows } from './accountsPageFixture.tsx';
import { required, type } from './dom.ts';

test('the accounts are listed with their role, yours marked, the others with what can be done', async () => {
  // luc last signed in at 13:00: two hours before now.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T15:00:00Z'));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { host } = await page();

  expect(
    [...host.querySelectorAll('[data-testid="accounts-table"] th')].map(
      (cell) => cell.textContent,
    ),
  ).toStrictEqual([
    'Username',
    'Role',
    'Added',
    'Last sign-in',
    'Password changed',
    '',
  ]);
  expect(rows(host)).toStrictEqual([
    [
      'ada',
      '[write]',
      'Oct 2, 2026',
      'never',
      'Oct 2, 2026',
      'Set passwordRemove',
    ],
    [
      'lucyou',
      'Administrator',
      'Oct 2, 2026',
      '2 hours ago',
      'Oct 2, 2026',
      '',
    ],
    [
      'max',
      '[read]',
      'Oct 2, 2026',
      'never',
      'Oct 2, 2026',
      'Set passwordRemove',
    ],
  ]);
  expect(
    host
      .querySelector('[data-testid="account-luc"] time')
      ?.getAttribute('title'),
  ).toBe('Oct 2, 2026, 12:00 PM UTC');
  expect(
    [
      ...(host.querySelector<HTMLSelectElement>(
        '[data-testid="account-ada"] select',
      )?.options ?? []),
    ].map((option) => [option.value, option.textContent]),
  ).toStrictEqual([
    ['read', 'Read'],
    ['write', 'Read and write'],
    ['admin', 'Administrator'],
  ]);
});

test('a role picked in the table is sent, and the list read again', async () => {
  const { host, server } = await page();
  const select = required(
    host.querySelector<HTMLSelectElement>('[data-testid="account-max"] select'),
    'role of max',
  );

  expect(select.getAttribute('aria-label')).toBe('Role of max');

  await type(select, 'write');

  expect(routes(server).slice(-2)).toStrictEqual([
    'PATCH /v1/account/users/3',
    'GET /v1/account/users',
  ]);
  expect(server.asked.at(-2)?.body).toStrictEqual({ role: 'write' });
  expect(rows(host)[2]?.[1]).toBe('[write]');
});

test('the account the .env defines is read only, and its own password is changed there', async () => {
  const { host } = await page({ envAdmin: true });

  const luc = required(
    host.querySelector<HTMLElement>('[data-testid="account-luc"]'),
    'row of luc',
  );
  const tag = [...luc.querySelectorAll('.accounts-table__tag')].at(-1);

  expect(tag?.textContent).toBe('defined in .env');
  expect(tag?.getAttribute('title')).toBe(
    "ADMIN_USERNAME and ADMIN_PASSWORD in the server's .env define this account, so it is changed there.",
  );
  expect(host.querySelector('[data-testid="change-password"]')).toBeNull();
  expect(
    host.querySelector('[aria-labelledby="accounts-own"] .accounts-note')
      ?.textContent,
  ).toBe(
    "The server's .env defines your account: change ADMIN_PASSWORD there, then restart the server.",
  );
});

test('a session that ended says so on the page, and lists nothing', async () => {
  const { host, store } = await page({ signedIn: null });

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'The session has ended: sign in again.',
  );
  expect(host.querySelector('[data-testid="accounts-table"]')).toBeNull();
  expect(host.querySelector('.bp6-spinner')).toBeNull();
  expect(store.get().notice?.code).toBe('sessionEnded');
});

test('an account that is not an administrator is told so on the page', async () => {
  const { host } = await page({ signedIn: 'ada' });

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'Your account cannot do this: ask an administrator.',
  );
  expect(host.querySelector('[data-testid="accounts-table"]')).toBeNull();
});
