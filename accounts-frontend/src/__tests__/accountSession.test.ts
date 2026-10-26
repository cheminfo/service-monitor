import { expect, onTestFinished, test, vi } from 'vitest';

import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import {
  ENDED,
  LUC,
  NOBODY,
  fakeServer,
  refusal,
  unreachable,
} from './fakeFetch.ts';

test('the session is unknown until read, then shared by everyone listening', async () => {
  const { fetcher } = fakeServer({
    'GET /v1/account/session': () => Response.json(NOBODY),
    'POST /v1/account/login': () => Response.json(LUC),
    'POST /v1/account/logout': () => Response.json(NOBODY),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/account', fetcher),
  );
  let changes = 0;
  const stop = store.subscribe(() => changes++);

  const unknown = store.get();
  await store.load();
  const read = store.get();
  const outcome = await store.signIn('luc', 'a password');
  const signedIn = store.get();
  await store.signOut();
  stop();
  await store.load();

  expect(unknown).toStrictEqual({ session: null, notice: null });
  expect(read.session).toStrictEqual(NOBODY);
  expect(outcome).toStrictEqual({ ok: true, value: LUC });
  expect(signedIn.session?.role).toBe('write');
  expect(store.get().session?.signedIn).toBe(false);
  expect(changes).toBe(3);
});

test('a refused sign-in says why, as a code, and leaves the session as it was', async () => {
  const { fetcher } = fakeServer({
    'POST /v1/account/login': () =>
      refusal(401, 'wrongCredentials', 'Wrong username or password.'),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/account', fetcher),
  );

  const outcome = await store.signIn('luc', 'a guess');

  expect(outcome).toStrictEqual({
    ok: false,
    failure: {
      code: 'wrongCredentials',
      status: 401,
      message: 'Wrong username or password.',
    },
  });
  expect(store.get()).toStrictEqual({ session: null, notice: null });
});

test('a session refused anywhere signs every page out, saying why', async () => {
  const { fetcher } = fakeServer({
    'POST /v1/account/login': () => Response.json(LUC),
    'GET /v1/account/users': () =>
      refusal(401, 'sessionEnded', 'The session has ended: sign in again.'),
    'POST /v1/account/users': () =>
      refusal(400, 'usernameTaken', 'That username is taken.'),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/account', fetcher),
  );
  await store.signIn('luc', 'a password');

  const taken = await store.attempt(() => store.client.addAccount('ada', 'x'));
  const stillIn = store.get().session?.signedIn;
  const ended = await store.attempt(() => store.client.accounts());

  expect(taken).toStrictEqual({
    ok: false,
    failure: {
      code: 'usernameTaken',
      status: 400,
      message: 'That username is taken.',
    },
  });
  expect(stillIn).toBe(true);
  expect(ended).toStrictEqual({ ok: false, failure: ENDED });
  expect(store.get()).toStrictEqual({ session: NOBODY, notice: ENDED });
});

test("the session's fetch carries the cookie, and a 401 signs every page out", async () => {
  const { fetcher } = fakeServer({
    'GET /v1/admin/session': () => Response.json(LUC),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', fetcher),
  );
  await store.load();
  const sent: Array<RequestInit | undefined> = [];
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(init);
    return Promise.resolve(
      sent.length === 1
        ? Response.json({ ok: true })
        : Response.json({ message: 'no' }, { status: 401 }),
    );
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const read = await store.fetch('/v1/admin/monitor/status');
  const stillIn = store.get().session?.signedIn;
  const refused = await store.fetch('/v1/admin/monitor/logs', {
    method: 'GET',
  });

  expect([read.status, stillIn]).toStrictEqual([200, true]);
  expect(sent).toStrictEqual([
    { credentials: 'same-origin' },
    { credentials: 'same-origin', method: 'GET' },
  ]);
  expect(refused.status).toBe(401);
  expect(store.get()).toStrictEqual({ session: NOBODY, notice: ENDED });
});

test('a sign-out the server does not answer asks it where things stand', async () => {
  let signedIn = true;
  const { fetcher, asked } = fakeServer({
    'GET /v1/account/session': () => Response.json(signedIn ? LUC : NOBODY),
    'POST /v1/account/logout': () => {
      signedIn = false;
      return new Response('Bad gateway', { status: 502 });
    },
  });
  const store = createAccountSession(
    createAccountsClient('/v1/account', fetcher),
  );
  await store.load();

  await store.signOut();

  expect(asked.map((each) => `${each.method} ${each.url}`)).toStrictEqual([
    'GET /v1/account/session',
    'POST /v1/account/logout',
    'GET /v1/account/session',
  ]);
  expect(store.get()).toStrictEqual({ session: NOBODY, notice: null });
});

test('an unreachable server reads as signed out, and fails with status 0 and no code', async () => {
  const store = createAccountSession(
    createAccountsClient('/v1/account', unreachable),
  );

  await store.load();
  const outcome = await store.signIn('luc', 'a password');

  expect(store.get().session).toStrictEqual(NOBODY);
  expect(outcome).toStrictEqual({
    ok: false,
    failure: {
      code: undefined,
      status: 0,
      message: 'the server could not be reached',
    },
  });
});

test('a load and the gates drawn meanwhile share one question, and a known session asks none', async () => {
  const { fetcher, asked } = fakeServer({
    'GET /v1/account/session': () => Response.json(LUC),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/account', fetcher),
  );

  await Promise.all([store.load(), store.ensureLoaded(), store.ensureLoaded()]);
  await store.ensureLoaded();

  expect(asked.map((each) => `${each.method} ${each.url}`)).toStrictEqual([
    'GET /v1/account/session',
  ]);
  expect(store.get().session).toStrictEqual(LUC);
});
