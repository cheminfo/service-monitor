# service-accounts-backend

The accounts that sign in to the operator's pages of a Fastify service:
PBKDF2 passwords, signed session cookies, a SQLite store every process may
open, the sign-in and account routes, and a guard for the host's own routes
that also takes the operator's token. The pages that sign in and manage the
accounts are
[`service-accounts-frontend`](https://www.npmjs.com/package/service-accounts-frontend).

```sh
npm install service-accounts-backend
```

```ts
import {
  accountStoreOpener,
  accountStorePath,
  createServiceAccounts,
} from 'service-accounts-backend';

const accounts = await createServiceAccounts({
  // Opened on first use, shared by every caller, tried again after a failure.
  store: accountStoreOpener(accountStorePath(process.env.DATA_DIR ?? 'data')),
  // One cookie per site, so two sites on one host keep their own sessions.
  cookieName: 'chembio_operator',
  purpose: 'chembio.cheminfo.org operator session',
  cookieSecret: process.env.COOKIE_SECRET,
  // For scripts; unset, only the accounts get in.
  adminToken: process.env.ADMIN_TOKEN,
});

// Signing in and out, and the accounts behind the guard.
await fastify.register(accounts.routes, { prefix: '/v1/admin' });

// The host's own operator routes: an account signed in, or the token.
await fastify.register(
  async (scope) => {
    accounts.protect(scope);
    scope.get('/status', (request) => request.signedInAccount?.username);
  },
  { prefix: '/v1/admin' },
);

// Once, as the server starts: the first account, from ADMIN_USERNAME
// (`admin` when unset) and ADMIN_PASSWORD.
await accounts.ensureFirstAccount(fastify.log);
```

List `accounts.securitySchemes` under `components.securitySchemes` of the
host's `@fastify/swagger` document: every route names the credentials it takes.

| Route               | Open to          | Does                                                                    |
| ------------------- | ---------------- | ----------------------------------------------------------------------- |
| `GET /session`      | everybody        | whether this browser is signed in, and as whom                          |
| `POST /login`       | everybody        | checks a username and password, and sets an 8-hour session cookie       |
| `POST /logout`      | everybody        | clears the cookie                                                       |
| `GET /users`        | the guard        | every account, never its password hash                                  |
| `POST /users`       | the guard        | adds an account                                                         |
| `PATCH /users/:id`  | the guard        | sets another account's password, which signs it out everywhere          |
| `DELETE /users/:id` | the guard        | removes an account: neither your own nor the last one                   |
| `POST /password`    | an account alone | changes your own password, given the current one; this browser stays in |

## What it guarantees

- **A password is stored as PBKDF2-HMAC-SHA-512**, 210,000 rounds, salted, as
  `pbkdf2$sha512$<iterations>$<salt>$<hash>`: learn.cheminfo.org's and
  molecules.cheminfo.org's format, so a hash moves between sites unchanged.
- **A session is stateless**: the account, its expiry and an HMAC-SHA256 over
  both, the site's `purpose` and the account's password hash. Changing the
  password, or removing the account, ends its sessions; changing
  `COOKIE_SECRET` ends them all. Unset, a key is drawn at start and a restart
  signs everybody out.
- **The cookie** is `HttpOnly`, `SameSite=Strict`, and `Secure` whenever the
  page came over HTTPS. Behind a proxy, Fastify sees HTTPS only once its
  `trustProxy` names that proxy.
- **Signing in and out, and every change a session asks for, come from the
  site's own pages**: a request whose `Origin` is another site is refused.
  The operator's token is a script's, and is taken from anywhere.
- **Ten sign-ins per client every fifteen minutes**, `signInLimit` to change
  it. A username nobody has costs a password check all the same, so the time
  of an answer does not say which usernames exist. A refused sign-in is
  logged with the client and the username, never the password.
- **No password is ever chosen for the operator.** Without `ADMIN_PASSWORD`
  the first account is not created, in development as in production: the
  server serves on and says so in its log.

## The store

`sqlite/accounts.sqlite` of the data directory, beside `db.sqlite` and the
monitor's `monitor.sqlite`. Its table records its migrations in
`service_accounts_version`, so the file may also hold the host's tables,
migrated by the host. Open it on `:memory:` in tests.
