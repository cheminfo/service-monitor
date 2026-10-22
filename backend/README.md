# service-monitor-backend

What every process of a service logs, how each one is doing, and the machine
under them, kept in one SQLite file every process writes to: a pino
destination, a heartbeat, the machine's figures, generic health checks, and a
Fastify plugin that reads them. The page that shows them is
[`service-monitor-frontend`](https://www.npmjs.com/package/service-monitor-frontend).

```sh
npm install service-monitor-backend
```

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

The file, the levels and topics, the heartbeats and the retention are
described in the
[repository's README](https://github.com/cheminfo/service-monitor#the-model).

## License

[MIT](./LICENSE)
