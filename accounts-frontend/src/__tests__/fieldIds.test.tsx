// @vitest-environment jsdom
import { expect, test } from 'vitest';

import { AddAccountForm } from '../AddAccountForm.tsx';
import { ChangePasswordForm } from '../ChangePasswordForm.tsx';
import { SetPasswordDialog } from '../SetPasswordDialog.tsx';
import { SignInDialog } from '../SignInDialog.tsx';
import { SignInGate } from '../SignInGate.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { fieldsLabelled, mount } from './dom.ts';
import { API, fakeServer } from './fakeServer.ts';

/**
 * The ids carried by more than one element of the page.
 * @returns Each id once per element after the first that carries it.
 */
function duplicateIds(): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const element of document.querySelectorAll('[id]')) {
    if (seen.has(element.id)) duplicates.push(element.id);
    seen.add(element.id);
  }
  return duplicates;
}

/**
 * Per label reading this text, the form it sits in, and whether the field it
 * names sits in that form too.
 * @param text - The label.
 * @returns `[form, 'own field' | 'another field']` per label, in page order.
 */
function labelledForms(text: string): string[][] {
  const fields = fieldsLabelled(document, text);
  const labels = [...document.querySelectorAll('label')].filter(
    (label) => label.textContent?.trim() === text,
  );
  return labels.map((label, index) => {
    const form = label.closest('form');
    return [
      form?.dataset.testid ?? 'none',
      fields[index]?.closest('form') === form ? 'own field' : 'another field',
    ];
  });
}

test("the sign-in form of a page and the header's dialog each name their own fields", async () => {
  const server = fakeServer();
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  await mount(
    <>
      <SignInGate store={store} title="Samples">
        <p>The samples</p>
      </SignInGate>
      <SignInDialog store={store} isOpen onClose={() => undefined} />
    </>,
  );

  expect(new Set(fieldsLabelled(document, 'Username')).size).toBe(2);
  expect(new Set(fieldsLabelled(document, 'Password')).size).toBe(2);
  expect(labelledForms('Username')).toStrictEqual([
    ['sign-in', 'own field'],
    ['sign-in-dialog', 'own field'],
  ]);
  expect(labelledForms('Password')).toStrictEqual([
    ['sign-in', 'own field'],
    ['sign-in-dialog', 'own field'],
  ]);
  expect(duplicateIds()).toStrictEqual([]);
});

test('forms of the Accounts page drawn twice, and the dialog over them, each name their own fields', async () => {
  const server = fakeServer({ signedIn: 'luc' });
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  await store.load();
  await mount(
    <>
      <ChangePasswordForm store={store} />
      <ChangePasswordForm store={store} />
      <AddAccountForm store={store} />
      <AddAccountForm store={store} />
      <SetPasswordDialog
        store={store}
        account={{
          id: 1,
          username: 'ada',
          role: 'write',
          envManaged: false,
          createdAt: 0,
          passwordChangedAt: 0,
          lastSignInAt: null,
        }}
        onClose={() => undefined}
      />
    </>,
  );

  expect(new Set(fieldsLabelled(document, 'New password')).size).toBe(3);
  expect(labelledForms('Current password')).toStrictEqual([
    ['change-password', 'own field'],
    ['change-password', 'own field'],
  ]);
  expect(labelledForms('New password, again')).toStrictEqual([
    ['change-password', 'own field'],
    ['change-password', 'own field'],
    ['set-password', 'own field'],
  ]);
  expect(new Set(fieldsLabelled(document, 'Username')).size).toBe(2);
  expect(new Set(fieldsLabelled(document, 'Role')).size).toBe(2);
  expect(labelledForms('Role')).toStrictEqual([
    ['add-account', 'own field'],
    ['add-account', 'own field'],
  ]);
  expect(duplicateIds()).toStrictEqual([]);
});
