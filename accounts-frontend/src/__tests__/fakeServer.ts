import type { Account, AccountSession } from '../types.ts';

/** One request the fake server was sent. */
export interface Asked {
  url: string;
  method: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

/** The password every account of the fake server signs in with. */
export const PASSWORD = 'the right password';

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

/**
 * The routes of service-accounts-backend, kept in memory: two accounts, `ada`
 * and `luc`, one password for both.
 * @param options - where it starts
 * @param options.signedIn - the account this browser is signed in as, if any
 * @returns the fetch, what it was asked, and its accounts
 */
export function fakeServer(options: { signedIn?: string } = {}) {
  const asked: Asked[] = [];
  let username = options.signedIn ?? null;
  const users: Account[] = [
    account(1, 'ada', null),
    account(2, 'luc', NOW + 3600),
  ];

  function session(): AccountSession {
    return { signedIn: username !== null, username };
  }

  function answer(method: string, path: string, body: Record<string, string>) {
    if (method === 'GET' && path === '/session') return json(session());
    if (method === 'POST' && path === '/login') {
      const known = users.some((user) => user.username === body.username);
      if (!known || body.password !== PASSWORD) {
        return refuse(401, 'wrong username or password');
      }
      username = body.username ?? null;
      return json(session());
    }
    if (method === 'POST' && path === '/logout') {
      username = null;
      return json(session());
    }
    if (username === null) {
      return refuse(401, 'the session has ended: sign in again');
    }
    if (method === 'GET' && path === '/users') return json({ users });
    if (method === 'POST' && path === '/users') {
      const name = (body.username ?? '').toLowerCase();
      if (users.some((user) => user.username === name)) {
        return refuse(400, `there is already an account named ${name}`);
      }
      const added = account(users.length + 1, name, null);
      users.push(added);
      users.sort((left, right) => left.username.localeCompare(right.username));
      return json(added);
    }
    if (method === 'POST' && path === '/password') {
      if (body.currentPassword !== PASSWORD) {
        return refuse(400, 'the current password is not that one');
      }
      return json(session());
    }
    const id = Number(/^\/users\/(?<id>\d+)$/.exec(path)?.groups?.id);
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) return refuse(404, `there is no account ${id}`);
    const [target] = users.slice(index, index + 1);
    if (method === 'PATCH') return json(target);
    if (method === 'DELETE') {
      users.splice(index, 1);
      return json(target);
    }
    return refuse(404, 'not found');
  }

  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, string>)
        : {};
    asked.push({
      url,
      method,
      body: typeof init?.body === 'string' ? body : undefined,
      credentials: init?.credentials,
    });
    return Promise.resolve(
      answer(method, url.replace(/^\/v1\/admin/, ''), body),
    );
  };

  return { fetcher, asked, users, session };
}

function account(
  id: number,
  username: string,
  lastSignInAt: number | null,
): Account {
  return {
    id,
    username,
    createdAt: NOW,
    passwordChangedAt: NOW,
    lastSignInAt,
  };
}

function json(body: unknown): Response {
  return Response.json(body);
}

function refuse(status: number, message: string): Response {
  return Response.json(
    { statusCode: status, error: 'Refused', message },
    { status },
  );
}
