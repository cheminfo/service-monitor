import { readHostMetrics } from '../host/hostMetrics.ts';
import type { MonitorStore } from '../store/MonitorStore.ts';
import type {
  HealthCheck,
  HostMetrics,
  MonitorStatus,
  ProcessView,
} from '../types.ts';

import {
  diskCheck,
  logErrorsCheck,
  memoryCheck,
  processChecks,
  sortChecks,
} from './checks.ts';

const HOUR = 3_600_000;

/**
 * What the host's own checks are given: what the generic ones read.
 */
export interface CheckContext {
  /**
   * The instant the status is read at, in unix milliseconds.
   */
  now: number;
  host: HostMetrics;
  processes: readonly ProcessView[];
  store: MonitorStore;
}

/**
 * How the status is read and judged.
 */
export interface MonitorStatusOptions {
  /**
   * A path on the volume whose free space is reported.
   * @default process.cwd()
   */
  dataDirectory?: string;
  /**
   * The roles a deployed service runs beside the main process, each with what
   * stops when none reports: `{ scheduler: 'no source is imported again' }`.
   * @default {}
   */
  expectedRoles?: Readonly<Record<string, string>>;
  /**
   * The role whose event loop answers requests, and is warned about when it
   * stalls.
   * @default 'server'
   */
  mainRole?: string;
  /**
   * The host's own checks, judged beside the generic ones.
   * @default undefined
   */
  checks?: (context: CheckContext) => HealthCheck[] | Promise<HealthCheck[]>;
}

/**
 * Read the machine and every process at one instant, and judge them: the
 * data volume, the container's memory, whether every process reports and
 * every expected role runs, the host's own checks, and the errors of the last
 * hour.
 * @param store - the store the processes and the lines are read from
 * @param options - where the data lives, and what is expected
 * @returns the status, its checks the worst first
 */
export async function readMonitorStatus(
  store: MonitorStore,
  options: MonitorStatusOptions = {},
): Promise<MonitorStatus> {
  const {
    dataDirectory = process.cwd(),
    expectedRoles,
    mainRole,
    checks,
  } = options;
  const readAt = Date.now();
  const host = readHostMetrics(dataDirectory);
  const processes = store.readProcesses(readAt);
  const errors = store.countRecentLogs('error', readAt - HOUR);
  return {
    readAt,
    checks: sortChecks([
      diskCheck(host),
      memoryCheck(host),
      ...processChecks(processes, { now: readAt, expectedRoles, mainRole }),
      ...(await ownChecks(checks, { now: readAt, host, processes, store })),
      ...logErrorsCheck(errors),
    ]),
    host,
    processes,
  };
}

/**
 * The host's own checks; one that throws is itself what is wrong.
 * @param checks - the host's checks, if any
 * @param context - what they read
 * @returns what they judged
 */
async function ownChecks(
  checks: MonitorStatusOptions['checks'],
  context: CheckContext,
): Promise<HealthCheck[]> {
  if (checks === undefined) return [];
  try {
    return await checks(context);
  } catch (error: unknown) {
    return [
      {
        id: 'checks',
        level: 'error',
        message: `The service's own checks failed: ${error instanceof Error ? error.message : String(error)}.`,
      },
    ];
  }
}
