# service-accounts-backend

The accounts that sign in to a Fastify service, with three roles: PBKDF2
passwords, signed session cookies remembered for 400 days, a SQLite store
every process may open, the sign-in and account routes, a guard for the host's
own routes, and the administrator the server's `.env` defines. The pages that
sign in and manage the accounts are
[`service-accounts-frontend`](https://www.npmjs.com/package/service-accounts-frontend).

```sh
npm install service-accounts-backend
```

```ts
import {
  accountStoreOpener,
  accountStorePath,
  createServiceAccounts,
  readAccountConfig,
} from 'service-accounts-backend';

// The cookie's `Secure` and the sign-in limit read the client through the
// proxy: `parseTrustProxy` of react-cheminfo/server reads TRUST_PROXY.
const fastify = Fastify({
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
});

const accounts = await createServiceAccounts({
  // Opened on first use, shared by every caller, tried again after a failure.
  store: accountStoreOpener(accountStorePath(process.env.DATA_DIR ?? 'data')),
  // One cookie per site, so two sites on one host keep their own sessions.
  cookieName: 'drugs_session',
  purpose: 'drugs.cheminfo.org session',
  // COOKIE_SECRET, ADMIN_TOKEN, ADMIN_SIGN_IN_LIMIT and NODE_ENV.
  ...readAccountConfig(),
});

// Signing in and out, and the accounts behind the guard, under the prefix the
// site chooses.
await fastify.register(accounts.routes, { prefix: '/v1/account' });

// The site's own routes: reading for every account, a change for `write`.
await fastify.register(
  async (scope) => {
    accounts.protect(scope);
    scope.get('/samples', listSamples);
    scope.post('/samples', { config: { accountRole: 'write' } }, addSample);
  },
  { prefix: '/v1' },
);

// A route open to everybody that shows the accounts more: who asks, or null.
fastify.get('/v1/compounds', async (request, reply) => {
  const signedIn = await accounts.signedIn(request); // { account, role } or null
  if (signedIn !== null) reply.header('cache-control', 'private');
  return listCompounds({ withDrafts: signedIn !== null });
});

// At every start: the administrator ADMIN_USERNAME and ADMIN_PASSWORD define.
await accounts.syncEnvAdmin(fastify.log);
```

List `accounts.securitySchemes` under `components.securitySchemes` of the
host's `@fastify/swagger` document: every route names the credentials it takes.

## One shared password

A site with one operator and no usernames — a label printer manager, say —
signs in with `createSharedPassword` from `service-accounts-backend/shared-password`
instead. It never loads the accounts' store. The sessions, the guard, the
`ADMIN_TOKEN`, the sign-in limit, the `Origin` check and the routes are the
ones above, so moving such a site to accounts later changes this call alone.

```ts
import {
  createSharedPassword,
  readAccountConfig,
} from 'service-accounts-backend/shared-password';

const access = await createSharedPassword({
  cookieName: 'zebra_session',
  purpose: 'zebra-label-printer-manager session',
  // The host keeps the hash, made by `hashPassword`, where it likes.
  readPasswordHash: () => db.getPasswordHash.get()?.value,
  writePasswordHash: (hash) => db.upsertPasswordHash.run(hash),
  // A hash the site kept before: checked once, then kept as PBKDF2.
  verifyLegacyHash: verifyScryptHash,
  ...readAccountConfig(),
});

await fastify.register(access.routes, { prefix: '/v1/auth' });

// Reads stay open to everybody; every change needs the password.
await fastify.register(
  async (scope) => {
    access.protect(scope, { openReads: true });
    scope.get('/printers', listPrinters);
    scope.post('/printers', addPrinter);
  },
  { prefix: '/v1' },
);
```

- **Routes**: `GET /session`, `POST /logout`, `POST /login` with
  `{ password }`, and `POST /password` with `{ currentPassword, newPassword }`.
  A session answers `{ signedIn, username: null, role: 'admin' }`.
- **A session** signs the account id `0`, its expiry, the `purpose` and the
  hash `readPasswordHash` returns, read again at every request: a new
  password ends every session.
- **No hash kept** means nobody signs in; the host seeds the first one.
- **`protect(scope, { openReads })`**: `GET`, `HEAD` and `OPTIONS` pass for
  everybody when `openReads` is true. `signedIn(request)` answers a boolean.

## Roles and the guard

`read` reads, `write` also changes the data, `admin` also manages the
accounts. An account added without a role only reads.

- **`protect(scope, { role })`** guards every route registered after it in an
  encapsulated scope of the host's: 401 with `www-authenticate: Bearer` when
  nobody is signed in, 403 below the role (`read` when left out), and 403 to a
  session asking for a change from another site's page. A route asks for more
  than its scope with `config: { accountRole: 'admin' }`, never less. It sets
  `request.signedInAccount`, null for the `ADMIN_TOKEN`.
- **`signedIn(request)`** reads the same credentials but refuses nobody:
  `{ account, role }` for an account signed in or sending its API token
  (§ API tokens), `{ account: null, role:
'admin' }` for the `ADMIN_TOKEN`, and `null` for anybody else, a session
  asking for a change from another site's page included.
- **The `ADMIN_TOKEN`** is a bearer token for scripts, acting as an
  administrator, taken from anywhere.
- **A new role applies at the next request**: a session reads its account
  again every time.

## Accounts in the host's own table

A site that already keeps its people — with their ids, their password hashes,
their roles and the foreign keys that point at them — hands that table to
`store` instead of `accounts.sqlite`, behind an `AccountDirectory`. The
routes, the guard, the sessions and `syncEnvAdmin` then read and write it, and
no second table of users exists.

```ts
import type {
  AccountDirectory,
  AccountRole,
  AccountRow,
} from 'service-accounts-backend';

// The host's roles, by the role of the accounts each stands for.
const HOST_ROLES = { read: 'guest', write: 'user', admin: 'admin' } as const;
const ACCOUNT_ROLES: Record<string, AccountRole> = {
  guest: 'read',
  user: 'write',
  admin: 'admin',
};

const COLUMNS = `id, mail AS username, password_hash AS passwordHash, role,
  env_admin AS envAdmin, created_at AS createdAt,
  password_set_at AS passwordChangedAt, last_login_at AS lastSignInAt`;
const NOT_THE_LAST_ADMIN = `(role != 'admin' OR
  (SELECT COUNT(*) FROM contacts WHERE role = 'admin') > 1)`;

function contacts(db: DatabaseSync): AccountDirectory {
  const byId = db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE id = ?`);
  const setRole = db.prepare(`UPDATE contacts SET role = ?1
    WHERE id = ?2 AND env_admin = 0 AND (?1 = 'admin' OR ${NOT_THE_LAST_ADMIN})`);
  // … one statement per method, as `AccountStore` writes them.
  return {
    byId: (id) => toAccount(byId.get(id)),
    setRole: (id, role) =>
      Number(setRole.run(HOST_ROLES[role], id).changes) > 0,
    // byUsername, all, count, insert, setPassword, touchSignIn,
    // removeUnlessLastAdmin, writeEnvAdmin, forgetEnvAdmins
  };
}

// What the SELECT answers: the account's columns, the host's role and mark.
type ContactRow = Omit<AccountRow, 'role' | 'envManaged'> & {
  role: string;
  envAdmin: number;
};

function toAccount(row: unknown): AccountRow | undefined {
  if (row === undefined) return undefined;
  const { role, envAdmin, ...contact } = row as ContactRow;
  return { ...contact, role: ACCOUNT_ROLES[role], envManaged: envAdmin === 1 };
}

const accounts = await createServiceAccounts({
  store: contacts(db),
  cookieName: 'pipeline_session',
  purpose: 'pipeline session',
  ...readAccountConfig(),
});
```

- **The methods are synchronous**, as `node:sqlite` is. A check the package
  makes before a write — the last administrator, a username taken — then runs
  in the same turn of the event loop as the write, so no other request of the
  process comes between them.
- **What the host keeps**, and the package relies on: usernames unique and in
  lower case (`insert` throws on one taken); the last administrator never
  demoted nor removed, `setRole` and `removeUnlessLastAdmin` answering false —
  in one statement, so two processes sharing the file cannot both succeed; the
  account the `.env` defines changed by `writeEnvAdmin` alone; every role one
  of `read`, `write` and `admin`. The package also refuses the last
  administrator before it asks, which holds within one process whatever the
  host does.
- **Roles of the host's own** are mapped both ways: in the rows it answers,
  and back in `insert` and `setRole`. A row whose role is none of the three
  is let through nowhere.
- **Usernames are those of the accounts**: 3 to 30 letters, digits, dots,
  dashes and underscores. A row whose username is outside that still signs
  in, but the routes add none like it.

Prove it with the checks the built-in store passes, in the host's own test:

```ts
import { accountDirectoryProblems } from 'service-accounts-backend';

test('the contacts are accounts', async () => {
  const problems = await accountDirectoryProblems(() =>
    contacts(migratedDatabase(':memory:')),
  );
  expect(problems).toStrictEqual([]);
});
```

`accountDirectoryProblems(open)` calls `open` once per check, each time for a
directory holding no account, and answers one sentence per broken guarantee:
`lastAdmin: setRole demoted the last admin`.

## API tokens

Workers and importers that act as an account, rather than as the operator,
send that account's token. The host keeps the tokens and says whose each is:

```ts
const directory = contacts(db);
const accounts = await createServiceAccounts({
  store: directory,
  // The account a token stands for, or undefined.
  verifyToken: (token) => {
    const row = tokenStatement.get(token);
    return row === undefined ? undefined : directory.byId(row.contactId);
  },
  // An EventSource cannot set a header: read `?token=` too.
  tokenQueryParameter: true,
  // …
});
```

- **`verifyToken(token)`** (default: none, only the `ADMIN_TOKEN` is taken)
  answers the `AccountRow` a token stands for, or `undefined`, synchronously
  or not. A request sending it as `Authorization: Bearer` is let through at
  that account's role: `protect` sets `request.signedInAccount`, and
  `signedIn` answers `{ account, role }`. A token is no cookie, so a change it
  asks for is taken from any page. The lookup is the host's, and so is
  comparing in constant time.
- **The `ADMIN_TOKEN` comes first** and keeps its meaning: `verifyToken` is
  never asked about it.
- **`tokenQueryParameter: true`** (default `false`) also reads `?token=` when
  no `Authorization` header is sent, for either token. A token in the address
  is written in the access logs of the server and of every proxy before it:
  keep it to the clients that cannot send a header.
- **A token nobody has** answers 401 `wrongToken`.
- `securitySchemes` then also lists `accountToken` (bearer) and `queryToken`
  (`?token=`), and every guarded route names them.

`createSharedPassword` takes both options too.

## Legacy hashes

A host moving its people over keeps their hashes as they are. Give
`createServiceAccounts` the check of the former format, as
`createSharedPassword` takes it:

```ts
const accounts = await createServiceAccounts({
  store: contacts(db),
  // `salt:hash` of scrypt: checked once, then kept as PBKDF2.
  verifyLegacyHash: verifyScryptHash,
  // …
});
```

- **A hash that is not `pbkdf2$sha512$…`** is checked by `verifyLegacyHash`
  at a sign-in and for the current password of `POST /password`. Once it
  matches at a sign-in, the password is hashed again with `hashPassword` and
  stored with `setPassword`, its date kept: the legacy hash is gone after the
  first sign-in.
- **Without `verifyLegacyHash`**, such a hash never verifies, and refusing it
  costs a password check all the same.
- A username nobody has still costs a password check, so the time of an
  answer does not say which exist; an account still on a legacy hash answers
  in the time its check takes.

## The administrator of the `.env`

With `ADMIN_PASSWORD` set, `syncEnvAdmin` makes sure at every start that the
account `ADMIN_USERNAME` (`admin` when unset) exists, is an administrator and
signs in with that password. It is the one account marked as defined by the
`.env`: the routes refuse to remove it, demote it or change its password, and
the Accounts page says so. Its password is hashed again only when it no longer
verifies, so a restart that keeps it keeps its sessions. Without
`ADMIN_PASSWORD`, no account is the `.env`'s and one line of the log says so:
no password is ever chosen for the operator.

| Variable              | Means                                                                     | Unset                                                      |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ADMIN_USERNAME`      | the administrator the `.env` defines                                      | `admin`                                                    |
| `ADMIN_PASSWORD`      | its password: at every start it exists, is `admin` and signs in with it   | no account is the `.env`'s, and the log says so            |
| `COOKIE_SECRET`       | the key sessions are signed with, `openssl rand -hex 32`                  | refused in production; elsewhere a random key, one warning |
| `ADMIN_TOKEN`         | a bearer token for scripts, acting as an administrator                    | none taken                                                 |
| `ADMIN_SIGN_IN_LIMIT` | sign-ins per client every fifteen minutes                                 | 10                                                         |
| `TRUST_PROXY`         | the proxies Fastify believes: the cookie's `Secure` and the limit need it | nothing believed                                           |

## Routes

| Route (under the prefix) | Open to                         | Does                                                       |
| ------------------------ | ------------------------------- | ---------------------------------------------------------- |
| `GET /session`           | everybody                       | `{ signedIn, username, role }`; renews a session a day old |
| `POST /login`            | everybody, from the site's page | checks a username and password, sets a 400-day cookie      |
| `POST /logout`           | everybody, from the site's page | clears the cookie                                          |
| `POST /password`         | every account                   | changes your own password, given the current one           |
| `GET /users`             | an administrator                | every account with its role, never its password hash       |
| `POST /users`            | an administrator                | adds an account, `read` unless a role is given             |
| `PATCH /users/:id`       | an administrator                | sets another account's password, its role, or both         |
| `DELETE /users/:id`      | an administrator                | removes another account: never the last administrator      |

A refusal answers `{ statusCode, error, message, code }`: `message` is
English, for a script and a log, and `code` is one of `ACCOUNT_REFUSALS`,
which a page writes in its own language from react-cheminfo's chrome catalog
(`account.refusal.<code>`).

## What it guarantees

- **A password is stored as PBKDF2-HMAC-SHA-512**, 210,000 rounds, salted, as
  `pbkdf2$sha512$<iterations>$<salt>$<hash>`: learn.cheminfo.org's and
  molecules.cheminfo.org's format, so a hash moves between sites unchanged.
- **A session is stateless and lasts 400 days**, the longest a browser keeps a
  cookie: the account, its expiry and an HMAC-SHA256 over both, the site's
  `purpose` and the account's password hash. `GET /session` hands out a fresh
  one once it is a day old, so somebody who keeps coming back never signs in
  again. Changing the password, or removing the account, ends its sessions;
  changing `COOKIE_SECRET` ends them all. In production `COOKIE_SECRET` is
  required, and `createServiceAccounts` throws without it.
- **The cookie** is `HttpOnly`, `SameSite=Strict`, and `Secure` whenever the
  page came over HTTPS. Behind a proxy, Fastify sees HTTPS only once its
  `trustProxy` names that proxy.
- **Signing in and out, and every change a session asks for, come from the
  site's own pages**: a request whose `Origin` is another site is refused.
- **The last administrator is never removed nor demoted**, in one statement,
  so two administrators demoting each other at once cannot both succeed.
- **Ten sign-ins per client every fifteen minutes**, `signInLimit` to change
  it. A username nobody has costs a password check all the same, so the time
  of an answer does not say which usernames exist. A refused sign-in is
  logged with the client and the username, never the password.

## The store

`sqlite/accounts.sqlite` of the data directory, beside `db.sqlite` and the
monitor's `monitor.sqlite`. Its table records its migrations in
`service_accounts_version`, so the file may also hold the host's tables,
migrated by the host. Open it on `:memory:` in tests.

Migration 002 gives every account a `role` and an `env_managed` mark. A store
of 0.1.0 migrates in place: its accounts could do everything, so they become
administrators, and none is the `.env`'s until the next start says so.

## From 0.1.0

- `ensureFirstAccount` and `firstAccount` are gone: call
  `accounts.syncEnvAdmin(fastify.log)` at every start instead.
- `protect(scope)` lets every account through: pass `{ role: 'admin' }`, or a
  route's `config: { accountRole }`, where only administrators or writers
  belong. The account routes are an administrator's.
- `COOKIE_SECRET` is required where `NODE_ENV` is `production`.
- A refusal carries a `code`, and its `message` is a sentence.
- `signedIn(request)` also answers the `role`.
