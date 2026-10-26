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
  `{ account, role }` for an account signed in, `{ account: null, role:
'admin' }` for the `ADMIN_TOKEN`, and `null` for anybody else, a session
  asking for a change from another site's page included.
- **The `ADMIN_TOKEN`** is a bearer token for scripts, acting as an
  administrator, taken from anywhere.
- **A new role applies at the next request**: a session reads its account
  again every time.

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
