import { Tag } from '@blueprintjs/core';
import {
  formatBytes,
  formatDuration,
  formatInteger,
  formatRelativeTime,
} from 'react-cheminfo/core';

import { activityValue } from './activityValue.ts';
import type { Activity, ProcessView } from './types.ts';

/**
 * Every process of the service, from what each last reported: whether it
 * still reports, its resources, how late its event loop runs, and what it
 * says it is doing.
 * @param props - The processes.
 * @param props.processes - What each reported, in the order shown.
 * @param props.now - When they were read, so every age is measured from it.
 * @returns The table.
 */
export function ProcessesTable(props: {
  processes: readonly ProcessView[];
  now: number;
}) {
  const { processes, now } = props;
  if (processes.length === 0) {
    return <p className="monitor-note">No process reports yet.</p>;
  }
  return (
    <div className="monitor-scroll">
      <table className="monitor-table" data-testid="monitor-processes">
        <thead>
          <tr>
            <th>Process</th>
            <th>State</th>
            <th className="monitor-table__count">Up</th>
            <th className="monitor-table__count">CPU</th>
            <th className="monitor-table__count">Memory</th>
            <th className="monitor-table__count">Loop delay</th>
            <th>Doing</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr key={`${process.hostname}-${process.pid}`}>
              <td>
                <strong>{process.role}</strong>
                <div className="monitor-faint">
                  pid {process.pid} on {process.hostname}
                </div>
              </td>
              <td>
                <Tag minimal intent={process.stale ? 'danger' : 'success'}>
                  {process.stale ? 'silent' : 'reporting'}
                </Tag>
                <div className="monitor-faint">
                  {formatRelativeTime(process.updatedAt, { now })}
                </div>
              </td>
              <td className="monitor-table__count">
                {formatDuration(now - process.startedAt)}
              </td>
              <td className="monitor-table__count">{process.cpuPercent}%</td>
              <td className="monitor-table__count">
                {formatBytes(process.memory.rss)}
                <div className="monitor-faint">
                  heap {formatBytes(process.memory.heapUsed)}
                </div>
              </td>
              <td className="monitor-table__count">
                {formatInteger(process.eventLoopDelayMs)} ms
              </td>
              <td>
                <ActivityList activity={process.activity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What a process says it is doing, as name–value pairs.
 * @param props - The activity.
 * @param props.activity - The figures the process reported.
 * @returns The list.
 */
function ActivityList(props: { activity: Activity }) {
  const entries = Object.entries(props.activity);
  if (entries.length === 0) {
    return <span className="monitor-faint">—</span>;
  }
  return (
    <ul className="monitor-activity">
      {entries.map(([name, value]) => (
        <li key={name}>
          <span className="monitor-faint">{name}</span>{' '}
          {activityValue(name, value)}
        </li>
      ))}
    </ul>
  );
}
