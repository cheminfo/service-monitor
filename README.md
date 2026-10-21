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
  them, and ninety days for warnings and errors. `store.prune()` deletes in
  chunks of 5000 rows, yielding between them.
- **Reads stay fast at any size.** Warnings and errors have partial indexes of
  their own, so reading them never walks past the request lines; a text search
  reads the most recent 100,000 lines and says when it stopped short.

## Backend

```ts
import pino from 'pino';
import {
  LogSink,
  MonitorStore,
  monitorStorePath,
  serviceMonitorPlugin,
  startHeartbeat,
} from 'service-monitor-backend';

// Once per process.
const sink = new LogSink();
const logger = pino(
  { name: 'importer' }, // the topic
  pino.multistream([{ stream: pino.destination(1) }, { stream: sink }]),
);

const store = MonitorStore.open(
  monitorStorePath(process.env.DATA_DIR ?? 'data'),
);
void sink.attach(store, { role: 'import' }); // lines logged before wait for it
const heartbeat = startHeartbeat({ store, role: 'import' });
heartbeat.activity.entries = 12_000;

// In the server: the routes, behind the host's authentication.
await fastify.register(serviceMonitorPlugin, {
  prefix: '/v1/admin/monitor',
  store: () => store,
  dataDirectory: 'data',
  preHandler: requireAdmin,
});

// Once an hour, in one process.
await (await store).prune(Date.now());
```

| Route              | Answers                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET /logs`        | a page of lines, the newest first; `minLevel`, `topic` and `role` (repeatable), `q`, `before`, `after`, `limit` |
| `GET /logs/facets` | the topics and roles that have logged, with when each last did                                                  |
| `GET /processes`   | what every process reported in the last day, each marked stale once it missed three beats                       |
| `GET /host`        | the machine's processor, memory and data volume, and the container's when it runs in one                        |

`diskCheck`, `memoryCheck`, `processChecks` and `logErrorsCheck` judge what the
store and the machine say; the host adds its own checks and sorts them all with
`sortChecks`.

## Frontend

```tsx
import 'service-monitor-frontend/styles.css';
import { LogsViewer } from 'service-monitor-frontend';

<LogsViewer apiBasePath="/v1/admin/monitor" />;
```

`fetcher` carries the host's authentication when a cookie does not. The panels
are styled with the tokens of react-cheminfo's `chrome.css`.

## Development

```sh
npm install
npm run test   # tests, types, lint and format, both packages
npm run tsc    # build lib/ in both packages, which a linked host reads
```

## License

[MIT](./LICENSE)
