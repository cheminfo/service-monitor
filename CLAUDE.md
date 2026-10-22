# service-monitor

Two npm packages from one repository, shaped like `sqlite3-viewer`:
`service-monitor-backend` (`backend/`) and `service-monitor-frontend`
(`frontend/`). Extracted from molecules.cheminfo.org's System page so every
site with several processes logs and reports the same way.

## The contract

- The HTTP contract is `backend/src/types.ts`, copied verbatim to
  `frontend/src/types.ts`. Change both in the same commit.
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

molecules.cheminfo.org, chembio.cheminfo.org, mz.cheminfo.org and openalex
(literature, on fat only), through `file:` links while unpublished. Each Vite
config dedupes React, Blueprint and react-cheminfo, which a linked package
would otherwise resolve from this checkout, and each host's `fastify` must be
the version installed here: a linked package reads the types of its own copy,
and two copies' types do not match. On fat every image is built with a
fat-only `Dockerfile.fat` that copies this checkout to `/service-monitor`.
