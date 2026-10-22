import { Button, Callout, Spinner, Tab, Tabs } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import { formatRelativeTime } from 'react-cheminfo/core';

import { HealthChecks } from '../HealthChecks.tsx';
import { HostPanel } from '../HostPanel.tsx';
import { ProcessesTable } from '../ProcessesTable.tsx';
import { createMonitorClient } from '../apiClient.ts';
import { LogsViewer } from '../logs/LogsViewer.tsx';
import type { MonitorStatus } from '../types.ts';

import type { MonitorSection } from './sections.ts';
import { MONITOR_SECTIONS } from './sections.ts';
import { useMonitorStatus } from './useMonitorStatus.ts';

/**
 * Where the monitor's routes are, and which section is on show.
 */
export interface ServiceMonitorProps {
  /**
   * Where the `service-monitor-backend` plugin is mounted, e.g. `/v1/monitor`.
   */
  apiBasePath: string;
  /**
   * The fetch to call, to carry the host's authentication; give the same
   * function at every render, or every render reads the status again.
   * @default globalThis.fetch
   */
  fetcher?: typeof fetch;
  /**
   * The section on show, for a page that keeps it in its address.
   * @default the component's own, from the overview
   */
  section?: MonitorSection;
  /**
   * Told which section a tab asks for.
   * @default undefined
   */
  onSectionChange?: (section: MonitorSection) => void;
  /**
   * How long after an answer the status is read again, in milliseconds.
   * @default 10000
   */
  refreshMs?: number;
}

/**
 * The monitor of a service, a tab per section: the health checks and the
 * machine, every process, and what every process logged. The status is read
 * again every ten seconds while it is on show; the logs read their own lines.
 * @param props - See {@link ServiceMonitorProps}.
 * @returns The monitor.
 */
export function ServiceMonitor(props: ServiceMonitorProps) {
  const { apiBasePath, fetcher, onSectionChange, refreshMs = 10_000 } = props;
  const [ownSection, setOwnSection] = useState<MonitorSection>('overview');
  const section = props.section ?? ownSection;
  const client = useMemo(
    () => createMonitorClient(apiBasePath, fetcher),
    [apiBasePath, fetcher],
  );
  const readsStatus = section !== 'logs';
  const { status, error, reload } = useMonitorStatus(client, {
    enabled: readsStatus,
    refreshMs,
  });

  return (
    <div className="monitor-page" data-testid="service-monitor">
      <div className="monitor-page__bar">
        <Tabs
          id="monitor-sections"
          selectedTabId={section}
          onChange={(id) => {
            setOwnSection(id as MonitorSection);
            onSectionChange?.(id as MonitorSection);
          }}
        >
          {MONITOR_SECTIONS.map(({ id, title }) => (
            <Tab key={id} id={id} title={title} />
          ))}
        </Tabs>
        {readsStatus && (
          <Button icon="refresh" text="Refresh" onClick={reload} />
        )}
      </div>
      {readsStatus && (
        <p className="monitor-note">
          {status === undefined
            ? 'Reading…'
            : `Read ${formatRelativeTime(status.readAt)} from ${status.host.hostname}; read again every ${Math.round(refreshMs / 1000)} s.`}
        </p>
      )}
      {readsStatus && error !== undefined && (
        <Callout
          intent="danger"
          icon="error"
          title="The status could not be read"
        >
          {error}
        </Callout>
      )}
      {section === 'logs' ? (
        <section className="monitor-panel" aria-labelledby="monitor-logs">
          <h2 id="monitor-logs">Logs</h2>
          <LogsViewer apiBasePath={apiBasePath} fetcher={fetcher} />
        </section>
      ) : status === undefined ? (
        error === undefined && <Spinner size={24} />
      ) : (
        <StatusSection section={section} status={status} />
      )}
    </div>
  );
}

/**
 * The overview or the processes, from one status.
 * @param props - The section and the status.
 * @param props.section - Which one is on show.
 * @param props.status - What the server last answered.
 * @returns The section.
 */
function StatusSection(props: {
  section: Exclude<MonitorSection, 'logs'>;
  status: MonitorStatus;
}) {
  const { section, status } = props;
  if (section === 'processes') {
    return (
      <section className="monitor-panel" aria-labelledby="monitor-processes">
        <h2 id="monitor-processes">Processes</h2>
        <ProcessesTable processes={status.processes} now={status.readAt} />
      </section>
    );
  }
  return (
    <div className="monitor-grid">
      <section className="monitor-panel" aria-labelledby="monitor-health">
        <h2 id="monitor-health">Health</h2>
        <HealthChecks checks={status.checks} />
      </section>
      <section className="monitor-panel" aria-labelledby="monitor-machine">
        <h2 id="monitor-machine">Machine</h2>
        <HostPanel host={status.host} />
      </section>
    </div>
  );
}
