import type { AccountRole } from '../rules.ts';
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

/** Where the fake server answers. */
export const API = '/v1/account';

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

/**
 * The routes of the accounts, kept in memory: `ada` (write, id 1), `luc`
 * (admin, id 2) and `max` (read, id 3), one password for all; `envAdmin`
 * marks luc as the account the .env defines.
 * @param options - Where it starts.
 * @param options.signedIn - The account this browser is signed in as, if any.
 * @param options.envAdmin - Whether luc is the .env's administrator.
 * @returns The fetch, what it was asked, and its accounts.
 */
export function fakeServer(
  options: { signedIn?: string; envAdmin?: boolean } = {},
) {
  const asked: Asked[] = [];
  let username = options.signedIn ?? null;
  const users: Account[] = [
    account(1, 'ada', 'write', null),
    {
      ...account(2, 'luc', 'admin', NOW + 3600),
      envManaged: !!options.envAdmin,
    },
    account(3, 'max', 'read', null),
  ];

  function session(): AccountSession {
    const role = users.find((user) => user.username === username)?.role;
    return { signedIn: username !== null, username, role: role ?? null };
  }

  function answer(method: string, path: string, body: Record<string, string>) {
    if (method === 'GET' && path === '/session') return json(session());
    if (method === 'POST' && path === '/login') {
      const known = users.some((user) => user.username === body.username);
      if (!known || body.password !== PASSWORD) {
        return refuse(401, 'wrongCredentials', 'Wrong username or password.');
      }
      username = body.username ?? null;
      return json(session());
    }
    if (method === 'POST' && path === '/logout') {
      username = null;
      return json(session());
    }
    if (username === null) {
      return refuse(
        401,
        'sessionEnded',
        'The session has ended: sign in again.',
      );
    }
    if (method === 'POST' && path === '/password') {
      if (body.currentPassword !== PASSWORD) {
        return refuse(
          400,
          'wrongCurrentPassword',
          'The current password is not that one.',
        );
      }
      return json(session());
    }
    if (session().role !== 'admin') {
      return refuse(
        403,
        'roleTooLow',
        'Your account cannot do this: ask an administrator.',
      );
    }
    if (method === 'GET' && path === '/users') return json({ users });
    if (method === 'POST' && path === '/users') {
      const name = (body.username ?? '').toLowerCase();
      if (users.some((user) => user.username === name)) {
        return refuse(400, 'usernameTaken', 'That username is taken.');
      }
      const role = (body.role ?? 'read') as AccountRole;
      const added = account(users.length + 1, name, role, null);
      users.push(added);
      users.sort((left, right) => left.username.localeCompare(right.username));
      return json(added);
    }
    const id = Number(/^\/users\/(?<id>\d+)$/.exec(path)?.groups?.id);
    const index = users.findIndex((user) => user.id === id);
    const target = users[index];
    if (target === undefined) {
      return refuse(404, 'noSuchAccount', 'That account no longer exists.');
    }
    if (method === 'PATCH') {
      if (body.role !== undefined) target.role = body.role as AccountRole;
      return json(target);
    }
    if (method === 'DELETE') {
      users.splice(index, 1);
      return json(target);
    }
    return refuse(404, 'noSuchAccount', 'That account no longer exists.');
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
    return Promise.resolve(answer(method, url.replace(API, ''), body));
  };

  return { fetcher, asked, users, session };
}

/**
 * An account of the fake server.
 * @param id - Its id.
 * @param username - Its username.
 * @param role - Its role.
 * @param lastSignInAt - When it last signed in, or null.
 * @returns The account.
 */
function account(
  id: number,
  username: string,
  role: AccountRole,
  lastSignInAt: number | null,
): Account {
  return {
    id,
    username,
    role,
    envManaged: false,
    createdAt: NOW,
    passwordChangedAt: NOW,
    lastSignInAt,
  };
}

function json(body: unknown): Response {
  return Response.json(body);
}

function refuse(status: number, code: string, message: string): Response {
  return Response.json(
    { statusCode: status, error: 'Refused', message, code },
    { status },
  );
}
