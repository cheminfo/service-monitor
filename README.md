# service-monitor

What every process of a service logs, how each one is doing, and the machine
under them — kept in one SQLite file every process writes to, and read from one
page. Two npm packages from one repository, like
[sqlite3-viewer](https://github.com/cheminfo/sqlite3-viewer):

| Package                                  | What it does                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`service-monitor-backend`](./backend)   | The store, a pino destination, a heartbeat, the machine's figures, generic health checks, and a Fastify plugin. |
| [`service-monitor-frontend`](./frontend) | `<LogsViewer>`, `<ProcessesTable>`, `<HostPanel>` and `<HealthChecks>`, on Blueprint and react-cheminfo.        |

The two talk only through the plugin's four routes. Each side holds the
contract in its own `types.ts`.

## The model

- **One file, at one path**: `<DATA_DIR>/sqlite/monitor.sqlite`, beside the
  service's own `sqlite/db.sqlite`, in every project — `monitorStorePath()`
  returns it. Every process opens it with its own connection; SQLite's
  write-ahead log lets them write at once. The store's tables carry a
  migration record of their own (`service_monitor_version`), so the host may
  keep tables of its own in the same file.
- **A line has a level and a topic.** The level is pino's number, which
  fifo-logger shares: 10 `trace` … 60 `fatal`. The topic is the name of the
  logger that wrote it; a line Fastify wrote for a request is `http`.
- **A process reports itself** every ten seconds: memory, processor share,
  event-loop delay and what it says it is doing. It removes its row when it
  stops, so one that died is told apart by the age of its row.
- **Retention** is a week for the lines below `warn`, at most a million of
  them, and ninety days for warnings and errors. The plugin deletes what is
  past it once an hour while the server runs, in chunks of 5000 rows, yielding
  between them.
- **Reads stay fast at any size.** Warnings and errors have partial indexes of
  their own, so reading them never walks past the request lines; a text search
  reads the most recent 100,000 lines and says when it stopped short.

## Backend

```ts
import pino from 'pino';
import {
  LogSink,
  monitorStoreOpener,
  monitorStorePath,
  serviceMonitorPlugin,
  startHeartbeat,
} from 'service-monitor-backend';

// Once per process. Each stream takes every level: the logger's decides.
const sink = new LogSink();
const logger = pino(
  { name: 'importer' }, // the topic
  pino.multistream([
    { level: 'trace', stream: pino.destination(1) },
    { level: 'trace', stream: sink },
  ]),
);

// Opened on first use, shared by every caller, tried again after a failure.
const store = monitorStoreOpener(
  monitorStorePath(process.env.DATA_DIR ?? 'data'),
);
// Lines logged before the store opens wait for it.
const heartbeat = startHeartbeat({ store: store(), role: 'import', sink });
heartbeat.activity.entries = 12_000;

// In the server: the routes, behind the host's authentication. The plugin also
// deletes the lines past their retention, once an hour.
await fastify.register(serviceMonitorPlugin, {
  prefix: '/v1/admin/monitor',
  store,
  dataDirectory: 'data',
  preHandler: requireAdmin, // a callback or an async hook
  expectedRoles: { scheduler: 'no source is imported again' },
});
```

| Route              | Answers                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET /logs`        | a page of lines, the newest first; `minLevel`, `topic` and `role` (repeatable), `q`, `before`, `after`, `limit` |
| `GET /logs/facets` | the topics and roles that have logged, with when each last did                                                  |
| `GET /processes`   | what every process reported in the last day, each marked stale once it missed three beats                       |
| `GET /host`        | the machine's processor, memory and data volume, and the container's when it runs in one                        |
| `GET /status`      | the health checks, the machine and every process, read at one instant: what a monitor page shows but the lines  |

`GET /status` judges the data volume, the container's memory, whether every
process reports and every role in `expectedRoles` runs, and the errors of the
last hour; `checks` adds the host's own. `readMonitorStatus` reads the same
for a host that composes a status of its own, and `diskCheck`, `memoryCheck`,
`processChecks`, `logErrorsCheck` and `sortChecks` are the pieces.

## Frontend

```tsx
import 'service-monitor-frontend/styles.css';
import { ServiceMonitor } from 'service-monitor-frontend';

<ServiceMonitor
  apiBasePath="/v1/admin/monitor"
  fetcher={adminFetch} // the host's authentication, when a cookie does not carry it
  section={section} // 'overview' | 'processes' | 'logs', from the address
  onSectionChange={navigateToSection}
/>;
```

`<ServiceMonitor>` is the whole page: a tab per section, the status read again
every ten seconds while it is on show. Give it the same `fetcher` at every
render. `<LogsViewer>`, `<ProcessesTable>`, `<HostPanel>` and `<HealthChecks>`
are its parts, for a host whose page holds more. The panels are styled with
the tokens of react-cheminfo's `chrome.css`.

## Development

```sh
npm install
npm run test   # tests, types, lint and format, both packages
npm run tsc    # build lib/ in both packages, which a linked host reads
```

## License

[MIT](./LICENSE)
