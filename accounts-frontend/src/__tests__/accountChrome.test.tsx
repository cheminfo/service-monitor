import type { ReactElement } from 'react';
import { CHROME_CATALOG } from 'react-cheminfo/core';
import { SiteLanguage } from 'react-cheminfo/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, expect, test } from 'vitest';

import { Instant } from '../Instant.tsx';
import { RoleSelect } from '../RoleSelect.tsx';
import { SignInForm } from '../SignInForm.tsx';
import { aboutSignIn } from '../aboutSignIn.ts';
import type { AccountFailure } from '../accountFailure.ts';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';
import { useAccountFailureText } from '../useAccountFailureText.ts';

beforeAll(async () => {
  await CHROME_CATALOG.load('fr');
});

const STORE = createAccountSession(
  createAccountsClient('/v1/account', () =>
    Promise.reject(new Error('no request in a static render')),
  ),
);

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

/**
 * The text of each failure, as a page in a language writes it.
 * @param props - The failures.
 * @param props.failures - What to write.
 * @returns One paragraph per failure.
 */
function Failures(props: { failures: AccountFailure[] }): ReactElement {
  const text = useAccountFailureText();
  return (
    <>
      {props.failures.map((failure) => (
        <p key={`${failure.status} ${failure.message}`}>{text(failure)}</p>
      ))}
    </>
  );
}

/**
 * The paragraphs of a markup, in order.
 * @param html - The markup.
 * @returns Their text.
 */
function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p>(?<text>[^<]*)<\/p>/g)].map(
    (match) => match.groups?.text ?? '',
  );
}

const FAILURES: AccountFailure[] = [
  {
    code: 'usernameLength',
    status: 400,
    message: 'A username has 3 to 30 characters.',
  },
  { code: 'lastAdmin', status: 400, message: 'The last administrator…' },
  { code: undefined, status: 0, message: 'the server could not be reached' },
  { code: undefined, status: 500, message: 'the server answered 500' },
];

test('a failure is written from its code, in the language of the page', () => {
  const english = renderToStaticMarkup(<Failures failures={FAILURES} />);
  const french = renderToStaticMarkup(
    <SiteLanguage value="fr">
      <Failures failures={FAILURES} />
    </SiteLanguage>,
  );

  expect(paragraphs(english)).toStrictEqual([
    'A username has 3 to 30 characters.',
    'The last administrator can be neither removed nor demoted.',
    'The server cannot be reached. Try again in a moment.',
    'The server answered 500.',
  ]);
  expect(paragraphs(french)).toStrictEqual([
    'Un nom d&#x27;utilisateur compte de 3 à 30 caractères.',
    'Le dernier administrateur ne peut être ni supprimé ni rétrogradé.',
    'Le serveur est injoignable. Réessayez dans un instant.',
    'The server answered 500.',
  ]);
});

test('the sign-in form and the roles are written in French on a French page', () => {
  const html = renderToStaticMarkup(
    <SiteLanguage value="fr">
      <SignInForm store={STORE} />
      <RoleSelect value="write" onChange={() => undefined} />
    </SiteLanguage>,
  );

  expect(html).toContain('<h1 id="accounts-sign-in-title">Se connecter</h1>');
  expect(html).toContain('Nom d&#x27;utilisateur');
  expect(html).toContain('Mot de passe');
  expect(
    [...html.matchAll(/<option[^>]*>(?<label>[^<]*)</g)].map(
      (match) => match.groups?.label,
    ),
  ).toStrictEqual(['Lecture', 'Lecture et écriture', 'Administrateur']);
});

test('an instant is a date in the language of the page, exact to the minute in its tooltip', () => {
  const english = renderToStaticMarkup(<Instant seconds={NOW} />);
  const french = renderToStaticMarkup(
    <SiteLanguage value="fr">
      <Instant seconds={NOW} />
    </SiteLanguage>,
  );

  expect(english).toBe(
    '<time dateTime="2026-10-02T12:00:00.000Z" title="Oct 2, 2026, 12:00 PM UTC">Oct 2, 2026</time>',
  );
  expect(french).toBe(
    '<time dateTime="2026-10-02T12:00:00.000Z" title="2 oct. 2026, 12:00 UTC">2 oct. 2026</time>',
  );
});

test('the About invites to sign in only once the server said nobody is', () => {
  const entry = { href: '/samples' };

  expect(aboutSignIn({ session: null, notice: null }, entry)).toBeUndefined();
  expect(
    aboutSignIn(
      {
        session: { signedIn: false, username: null, role: null },
        notice: null,
      },
      entry,
    ),
  ).toBe(entry);
  expect(
    aboutSignIn(
      {
        session: { signedIn: true, username: 'luc', role: 'admin' },
        notice: null,
      },
      entry,
    ),
  ).toBeUndefined();
});
