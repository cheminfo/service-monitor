import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';

import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { fakeServer, refusal } from './fakeFetch.ts';

/** Where a browser stands once signed in with a shared password. */
const SHARED = { signedIn: true, username: null, role: 'admin' };

test('signing in with a shared password sends the password alone', async () => {
  const { fetcher, asked } = fakeServer({
    'POST /v1/auth/login': () => Response.json(SHARED),
  });
  const store = createAccountSession(createAccountsClient('/v1/auth', fetcher));

  const outcome = await store.signInWithPassword('the shared password');

  expect(outcome).toStrictEqual({ ok: true, value: SHARED });
  expect(store.get()).toStrictEqual({ session: SHARED, notice: null });
  expect(asked).toStrictEqual([
    {
      url: '/v1/auth/login',
      method: 'POST',
      body: { password: 'the shared password' },
      credentials: 'same-origin',
      cache: 'no-store',
    },
  ]);
});

test('a refused shared password says why and leaves the session as it was', async () => {
  const { fetcher } = fakeServer({
    'POST /v1/auth/login': () =>
      refusal(429, 'tooManyAttempts', 'Too many sign-ins from here.'),
  });
  const store = createAccountSession(createAccountsClient('/v1/auth', fetcher));

  const outcome = await store.signInWithPassword('a guess');

  expect(outcome).toStrictEqual({
    ok: false,
    failure: {
      code: 'tooManyAttempts',
      status: 429,
      message: 'Too many sign-ins from here.',
    },
  });
  expect(store.get()).toStrictEqual({ session: null, notice: null });
});

test('the session entry imports neither react-cheminfo nor Blueprint', () => {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const pending = [join(import.meta.dirname, '../session.ts')];
  while (pending.length > 0) {
    const file = pending.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'(?<specifier>[^']+)'/gms,
    )) {
      const specifier = match.groups?.specifier ?? '';
      if (specifier.startsWith('.')) {
        pending.push(join(dirname(file), specifier));
      } else {
        packages.add(specifier);
      }
    }
  }

  expect([...packages]).toStrictEqual(['react']);
});
