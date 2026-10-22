import { expect, onTestFinished, test, vi } from 'vitest';

import { aboutSignIn } from '../aboutSignIn.ts';
import { createAccountSession } from '../accountSession.ts';
import {
  AccountsRequestError,
  createAccountsClient,
  messageOf,
  sentenceOf,
} from '../accountsClient.ts';
import { pairProblem } from '../passwords.ts';

/**
 * A server nothing reaches.
 * @returns a rejected request, as a fetch with no network answers
 */
const unreachable: typeof fetch = () =>
  Promise.reject(new TypeError('fetch failed'));

/** One request the fake server was sent. */
interface Asked {
  url: string;
  method: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

/**
 * A server answering each route from a table, and remembering what it was
 * asked.
 * @param answers - the answer by `METHOD url`
 * @returns the fetch, and what it was asked
 */
function fakeServer(answers: Record<string, () => Response>) {
  const asked: Asked[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    asked.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
    });
    const answer = answers[`${method} ${url}`];
    return Promise.resolve(
      answer === undefined
        ? Response.json({ message: 'not found' }, { status: 404 })
        : answer(),
    );
  };
  return { fetcher, asked };
}

test('the client sends JSON with the cookie, and a refusal keeps its status', async () => {
  const { fetcher, asked } = fakeServer({
    'POST /v1/admin/login': () =>
      Response.json({ signedIn: true, username: 'luc' }),
    'GET /v1/admin/users': () =>
      Response.json({ message: 'the session has ended' }, { status: 401 }),
  });
  const client = createAccountsClient('/v1/admin', fetcher);

  const session = await client.signIn('Luc', 'a password');
  const refused = await client.accounts().catch((error: unknown) => error);

  expect(session).toStrictEqual({ signedIn: true, username: 'luc' });
  expect(asked[0]).toStrictEqual({
    url: '/v1/admin/login',
    method: 'POST',
    body: { username: 'Luc', password: 'a password' },
    credentials: 'same-origin',
  });
  expect(refused).toBeInstanceOf(AccountsRequestError);
  expect([
    (refused as AccountsRequestError).status,
    (refused as AccountsRequestError).message,
  ]).toStrictEqual([401, 'the session has ended']);
});

test('the session is unknown until read, then shared by everyone listening', async () => {
  const { fetcher } = fakeServer({
    'GET /v1/admin/session': () =>
      Response.json({ signedIn: false, username: null }),
    'POST /v1/admin/login': () =>
      Response.json({ signedIn: true, username: 'luc' }),
    'POST /v1/admin/logout': () =>
      Response.json({ signedIn: false, username: null }),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', fetcher),
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
  expect(read.session).toStrictEqual({ signedIn: false, username: null });
  expect(outcome).toStrictEqual({
    ok: true,
    value: { signedIn: true, username: 'luc' },
  });
  expect(signedIn.session?.username).toBe('luc');
  expect(store.get().session?.signedIn).toBe(false);
  expect(changes).toBe(3);
});

test('a refused sign-in says why, and leaves the session as it was', async () => {
  const { fetcher } = fakeServer({
    'POST /v1/admin/login': () =>
      Response.json({ message: 'wrong username or password' }, { status: 401 }),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', fetcher),
  );

  const outcome = await store.signIn('luc', 'a guess');

  expect(outcome).toStrictEqual({
    ok: false,
    error: 'Wrong username or password.',
  });
  expect(store.get()).toStrictEqual({ session: null, notice: null });
});

test('a session refused anywhere signs every page out, saying why', async () => {
  const { fetcher } = fakeServer({
    'POST /v1/admin/login': () =>
      Response.json({ signedIn: true, username: 'luc' }),
    'GET /v1/admin/users': () =>
      Response.json(
        { message: 'the session has ended: sign in again' },
        { status: 401 },
      ),
    'POST /v1/admin/users': () =>
      Response.json(
        { message: 'there is already an account named ada' },
        { status: 400 },
      ),
  });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', fetcher),
  );
  await store.signIn('luc', 'a password');

  const taken = await store.attempt(() => store.client.addAccount('ada', 'x'));
  const stillIn = store.get().session?.signedIn;
  const ended = await store.attempt(() => store.client.accounts());

  expect(taken).toStrictEqual({
    ok: false,
    error: 'There is already an account named ada.',
  });
  expect(stillIn).toBe(true);
  expect(ended).toStrictEqual({
    ok: false,
    error: 'The session has ended: sign in again.',
  });
  expect(store.get()).toStrictEqual({
    session: { signedIn: false, username: null },
    notice: 'The session has ended: sign in again.',
  });
});

test('the About invites to sign in only once the server said nobody is', () => {
  const entry = { href: '/status' };

  expect(aboutSignIn({ session: null, notice: null }, entry)).toBeUndefined();
  expect(
    aboutSignIn(
      { session: { signedIn: false, username: null }, notice: null },
      entry,
    ),
  ).toBe(entry);
  expect(
    aboutSignIn(
      { session: { signedIn: true, username: 'luc' }, notice: null },
      entry,
    ),
  ).toBeUndefined();
});

test('a message becomes a sentence, and two new passwords must agree', () => {
  expect(sentenceOf(new Error('the server answered 500'))).toBe(
    'The server answered 500.',
  );
  expect(sentenceOf(new Error('Done!'))).toBe('Done!');
  expect(sentenceOf('nothing')).toBe('The request failed.');
  expect(pairProblem('a', 'a')).toBeNull();
  expect(pairProblem('a', 'b')).toBe('The two new passwords differ.');
});

test("the session's fetch carries the cookie, and a 401 signs every page out", async () => {
  const { fetcher } = fakeServer({
    'GET /v1/admin/session': () =>
      Response.json({ signedIn: true, username: 'luc' }),
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
  expect(store.get()).toStrictEqual({
    session: { signedIn: false, username: null },
    notice: 'The session has ended: sign in again.',
  });
});

test('a sign-out the server does not answer asks it where things stand', async () => {
  let signedIn = true;
  const { fetcher, asked } = fakeServer({
    'GET /v1/admin/session': () =>
      Response.json({ signedIn, username: signedIn ? 'luc' : null }),
    'POST /v1/admin/logout': () => {
      signedIn = false;
      return new Response('Bad gateway', { status: 502 });
    },
  });
  const store = createAccountSession(
    createAccountsClient('/v1/admin', fetcher),
  );
  await store.load();

  await store.signOut();

  expect(asked.map((each) => `${each.method} ${each.url}`)).toStrictEqual([
    'GET /v1/admin/session',
    'POST /v1/admin/logout',
    'GET /v1/admin/session',
  ]);
  expect(store.get()).toStrictEqual({
    session: { signedIn: false, username: null },
    notice: null,
  });
});

test('a refusal with no message names its status, and an unreachable server reads as signed out', async () => {
  const store = createAccountSession(
    createAccountsClient('/v1/admin', unreachable),
  );

  await store.load();

  await expect(
    messageOf(new Response('<html>busy</html>', { status: 503 })),
  ).resolves.toBe('the server answered 503');
  await expect(
    messageOf(Response.json({ message: '' }, { status: 500 })),
  ).resolves.toBe('the server answered 500');
  expect(store.get().session).toStrictEqual({
    signedIn: false,
    username: null,
  });
});
