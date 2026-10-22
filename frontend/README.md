# service-monitor-frontend

The page of a service's monitor: the logs of every process by topic and level,
the processes, the machine and the health checks, read from the routes of
[`service-monitor-backend`](https://www.npmjs.com/package/service-monitor-backend).
Built on Blueprint and react-cheminfo, which the host provides with React.

```sh
npm install service-monitor-frontend
```

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

More in the [repository's README](https://github.com/cheminfo/service-monitor).

## License

[MIT](./LICENSE)
