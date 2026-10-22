import { Button, Callout, Spinner } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import { useDebouncedValue } from 'react-cheminfo/ui';

import type { LogFilters } from '../apiClient.ts';
import { createMonitorClient } from '../apiClient.ts';
import type { LogLevel } from '../types.ts';

import { LogFilterBar } from './LogFilterBar.tsx';
import { LogList } from './LogList.tsx';
import { toggled } from './logLines.ts';
import { useLogReading } from './useLogReading.ts';

/**
 * Where the lines come from, and how they are read.
 */
export interface LogsViewerProps {
  /**
   * Where the `service-monitor-backend` plugin is mounted, e.g. `/v1/monitor`.
   */
  apiBasePath: string;
  /**
   * The fetch to call, to carry the host's authentication.
   * @default globalThis.fetch
   */
  fetcher?: typeof fetch;
  /**
   * How often the lines written since are read while live, in milliseconds.
   * @default 5000
   */
  refreshMs?: number;
  /**
   * The lines a page holds.
   * @default 200
   */
  pageSize?: number;
  /**
   * The least severe level shown at first.
   * @default 'info'
   */
  initialMinLevel?: LogLevel;
}

/**
 * What every process of the service logged, the newest first: filtered by the
 * least severe level, by topic, by process and by text, read as it comes
 * while live, and older pages on demand.
 * @param props - See {@link LogsViewerProps}.
 * @returns The viewer.
 */
export function LogsViewer(props: LogsViewerProps) {
  const {
    apiBasePath,
    fetcher,
    refreshMs = 5000,
    pageSize = 200,
    initialMinLevel = 'info',
  } = props;
  const client = useMemo(
    () => createMonitorClient(apiBasePath, fetcher),
    [apiBasePath, fetcher],
  );
  const [minLevel, setMinLevel] = useState<LogLevel>(initialMinLevel);
  const [topics, setTopics] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [text, setText] = useState('');
  const searched = useDebouncedValue(text, 300);
  const [isLive, setIsLive] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const filters = useMemo<LogFilters>(
    () => ({ minLevel, topics, roles, text: searched }),
    [minLevel, topics, roles, searched],
  );
  const { reading, isCurrent, facets, isLoadingOlder, loadOlder, reload } =
    useLogReading(client, filters, { pageSize, refreshMs, isLive });
  // A page that could not be read holds no line, which is not the same as no
  // line matching: the error is all that is said.
  const hasFailed =
    isCurrent && Boolean(reading?.error) && reading?.lines.length === 0;

  return (
    <div className="monitor-logs" data-testid="monitor-logs">
      <LogFilterBar
        minLevel={minLevel}
        onMinLevel={setMinLevel}
        facets={facets}
        topics={topics}
        onTopics={setTopics}
        roles={roles}
        onRoles={setRoles}
        text={text}
        onText={setText}
        isLive={isLive}
        onLive={setIsLive}
        onReload={reload}
      />
      {isCurrent && reading?.error && (
        <Callout
          intent="danger"
          icon="error"
          title="The lines could not be read"
        >
          {reading.error}
        </Callout>
      )}
      {isCurrent && reading?.truncated && (
        <p className="monitor-note">
          The search read the most recent lines only.
        </p>
      )}
      {reading === null && <Spinner size={24} />}
      {reading !== null && !hasFailed && (
        <div className={isCurrent ? undefined : 'monitor-logs__stale'}>
          <LogList
            lines={reading.lines}
            expanded={expanded}
            onToggle={(id) => setExpanded((open) => toggled(open, id))}
            now={reading.readAt}
          />
        </div>
      )}
      {isCurrent && reading?.nextBefore != null && (
        <Button
          className="monitor-logs__older"
          icon="arrow-down"
          text="Older lines"
          loading={isLoadingOlder}
          onClick={() => void loadOlder()}
        />
      )}
    </div>
  );
}
