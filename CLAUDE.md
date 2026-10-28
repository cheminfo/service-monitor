# service-monitor

Four npm packages from one repository, shaped like `sqlite3-viewer`:
`service-monitor-backend` (`backend/`) and `service-monitor-frontend`
(`frontend/`), extracted from molecules.cheminfo.org's System page so every
site with several processes logs and reports the same way; and
`service-accounts-backend` (`accounts-backend/`) and
`service-accounts-frontend` (`accounts-frontend/`), extracted from
molecules.cheminfo.org's Admin sign-in so every site's operator signs in the
same way.

## The contract

- The HTTP contract is `backend/src/types.ts`, copied verbatim to
  `frontend/src/types.ts`. Change both in the same commit. The accounts'
  contract is `accounts-backend/src/types.ts` and `accounts-backend/src/rules.ts`
  (the roles, the refusal codes and their English, the username and password
  rules), the same bytes as their copies in `accounts-frontend/src`; a frontend
  test fails while they differ.
- The accounts come in two kinds, and every site uses one of them, never a
  sign-in of its own: `createServiceAccounts` (accounts in
  `accounts.sqlite`) and `createSharedPassword` from
  `service-accounts-backend/shared-password` (one password the host keeps, no
  store). Both share the sessions, the guard and the session routes; a fix to
  either is a fix to both.
- The accounts' words are react-cheminfo's chrome: every string of
  `accounts-frontend` is an `account.*` key read with `useChromeT`, in every
  locale catalog of react-cheminfo, never a literal here. A refusal's English
  in `rules.ts` is the catalog's `account.refusal.<code>`; a frontend test
  fails while they differ. A new refusal or a new word is a react-cheminfo
  change first.
- The accounts' store is `sqlite/accounts.sqlite`, its migrations recorded in
  `service_accounts_version`. `accounts-backend/src/store/migrate.ts` is the
  monitor's `migrate.ts` with that table name: fix a trap in one, fix it in
  both. Never edit a migration already released (001, 002): Postgrator checks
  their checksums, and the stores of chembio and mz carry them.
- Levels are pino's numbers (fifo-logger's too). The topic is the logger's
  `name`; a line with a `reqId` is `http`, whatever its name.
- The store's migrations live in `backend/src/store/migrations` as
  `NNN.do.sql` / `NNN.undo.sql`, recorded in `service_monitor_version`, never
  in the default `schemaversion`: the host migrates its own tables in the same
  file. The compiled `lib/store/migrate.js` reads them from `src`, which is
  published.

## Traps already met

- **Two opens in one process deadlock on a synchronous busy wait.** Postgrator
  reads its files between statements, so a second connection blocking the
  event loop on `BEGIN IMMEDIATE` keeps the first from ever committing.
  `migrate()` takes no lock when the file is current, and otherwise retries the
  lock asynchronously. A host that migrates its own tables in the same file
  must open the store first.
- **A level filter walks the whole table without the partial indexes.** SQLite
  cannot tell `level >= 50` is rare; `INDEXED BY logs_errors` /
  `logs_problems` with the literal floor makes it 0.5 ms at a million lines
  instead of 20–50 ms. Measured with 1,000,000 lines, 0.5 % warnings.
- **Never a synchronous wait longer than a few seconds in the sink.** A logger
  waits with it: `busy_timeout` is 5 s, and a failed flush keeps the lines for
  the next tick rather than throwing into pino.

## Consumers

The shared password: zebra-label-printer-manager, with dialogs of its own over
`service-accounts-frontend/session`, since it stays on React 18 and
react-cheminfo needs 19. The accounts: chembio.cheminfo.org and mz.cheminfo.org on 0.1.0 from npm,
with the routes under `/v1/admin`; drugs.cheminfo.org through `file:` links,
under `/v1/account`. molecules.cheminfo.org and literature still carry their
own sign-in or token gate and move to it next. Until react-cheminfo publishes
the `account.*` keys (0.70.0), `accounts-frontend` links its checkout
(`file:../../react-cheminfo`) and its Vitest dedupes React and Blueprint; put
the registry range back once it is out, or the CI install fails.

The monitor: molecules.cheminfo.org, chembio.cheminfo.org, mz.cheminfo.org and
openalex (literature, on fat only), through `file:` links while unpublished. Each Vite
config dedupes React, Blueprint and react-cheminfo, which a linked package
would otherwise resolve from this checkout, and each host's `fastify` must be
the version installed here: a linked package reads the types of its own copy,
and two copies' types do not match. On fat every image is built with a
fat-only `Dockerfile.fat` that copies this checkout to `/service-monitor`.
