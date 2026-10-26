// @vitest-environment jsdom
import { useState } from 'react';
import { AboutPage } from 'react-cheminfo/ui';
import { expect, test } from 'vitest';

import { SignInDialog } from '../SignInDialog.tsx';
import { aboutSignIn } from '../aboutSignIn.ts';
import type { AccountSessionStore } from '../accountSession.ts';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';
import { useAccountSession } from '../useAccountSession.ts';

import { button, click, mount, required, type } from './dom.ts';
import { API, PASSWORD, fakeServer } from './fakeServer.ts';

/**
 * An About page whose invitation opens the sign-in dialog, as a site with no
 * page for signing in draws it.
 * @param props - The site's session.
 * @param props.store - The session.
 * @returns The page.
 */
function About(props: { store: AccountSessionStore }) {
  const { store } = props;
  const state = useAccountSession(store);
  const [signingIn, setSigningIn] = useState(false);

  return (
    <>
      <AboutPage
        content={{
          siteId: 'smiles',
          what: 'Draw a structure and read its SMILES.',
          can: ['Draw.', 'Read.', 'Search.'],
          credits: ['react'],
        }}
        signIn={aboutSignIn(state, { onSignIn: () => setSigningIn(true) })}
      />
      <SignInDialog
        store={store}
        isOpen={signingIn}
        onClose={() => setSigningIn(false)}
      />
    </>
  );
}

/**
 * The About of a site, its session read from a fake server.
 * @returns The page, the session and the server.
 */
async function about() {
  const server = fakeServer();
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  await store.load();
  const host = await mount(<About store={store} />);
  return { host, server, store };
}

test("the About's invitation opens the dialog, which signs in and closes", async () => {
  const { host, store } = await about();

  await click(host.querySelector('button.about-sign-in'));
  const dialog = required(
    document.querySelector<HTMLElement>('[data-testid="sign-in-dialog"]'),
    'sign-in dialog',
  );
  const title = document.querySelector('.bp6-dialog-header')?.textContent;

  await type(dialog.querySelector('#accounts-username'), 'ada');
  await type(dialog.querySelector('#accounts-password'), 'a guess');
  await click(button(dialog, 'Sign in'));
  const refusal = dialog.querySelector('[role="alert"]')?.textContent;

  await type(dialog.querySelector('#accounts-password'), PASSWORD);
  await click(button(dialog, 'Sign in'));

  expect(title).toBe('Sign in');
  expect(refusal).toBe('Wrong username or password.');
  expect(store.get().session).toStrictEqual({
    signedIn: true,
    username: 'ada',
    role: 'write',
  });
  expect(document.querySelector('.bp6-overlay-open')).toBeNull();
  // Signed in, the About no longer invites to sign in: the account is in the
  // bar.
  expect(host.querySelector('.about-sign-in')).toBeNull();
});

test('backing out closes the dialog and keeps nobody signed in', async () => {
  const { host, server } = await about();

  await click(host.querySelector('button.about-sign-in'));
  await type(document.querySelector('#accounts-username'), 'ada');
  await click(button(document.body, 'Cancel'));
  await click(host.querySelector('button.about-sign-in'));

  expect(server.asked.map((each) => each.url)).toStrictEqual([
    '/v1/account/session',
  ]);
  expect(
    document.querySelector<HTMLInputElement>('#accounts-username')?.value,
  ).toBe('');
});
