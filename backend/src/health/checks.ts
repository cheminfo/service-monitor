import type { HealthCheck, HostMetrics, ProcessView } from '../types.ts';

/**
 * What the process checks expect.
 */
export interface ProcessCheckOptions {
  /**
   * The current instant, in unix milliseconds.
   */
  now: number;
  /**
   * The roles a deployed service runs beside the main process, each with what
   * stops when none reports: `{ 'refresh-stats': 'nothing new is counted' }`.
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
   * An event loop that stalls this long, in milliseconds, answers late.
   * @default 200
   */
  slowEventLoopMs?: number;
}

const ORDER = { error: 0, warning: 1, info: 2, ok: 3 } as const;

/**
 * Checks in the order a reader wants them: what is wrong, then what is in
 * progress, then what was looked at and found fine.
 * @param checks - the checks
 * @returns them, the worst first; equal ones keep their order
 */
export function sortChecks(checks: readonly HealthCheck[]): HealthCheck[] {
  return checks.toSorted((a, b) => ORDER[a.level] - ORDER[b.level]);
}

/**
 * How full the data volume is.
 * @param host - the machine
 * @returns the check
 */
export function diskCheck(host: HostMetrics): HealthCheck {
  const share = host.disk.available / Math.max(1, host.disk.total);
  const left = `${Math.round(share * 100)}% of the data volume is free`;
  if (share < 0.05) {
    return {
      id: 'disk',
      level: 'error',
      message: `${left}: writes will fail. Free space or grow the volume.`,
    };
  }
  if (share < 0.15) {
    return {
      id: 'disk',
      level: 'warning',
      message: `${left}. Plan more space before it fills.`,
    };
  }
  return { id: 'disk', level: 'ok', message: `${left}.` };
}

/**
 * How close the container is to its memory limit.
 * @param host - the machine
 * @returns the check
 */
export function memoryCheck(host: HostMetrics): HealthCheck {
  const { containerUsed, containerLimit } = host.memory;
  if (containerUsed === null || containerLimit === null) {
    return {
      id: 'memory',
      level: 'ok',
      message: 'The server runs without a memory limit.',
    };
  }
  const share = containerUsed / containerLimit;
  const used = `The server's container uses ${Math.round(share * 100)}% of its memory limit`;
  if (share > 0.9) {
    return {
      id: 'memory',
      level: 'warning',
      message: `${used}: it is killed when it reaches it. Raise mem_limit.`,
    };
  }
  return { id: 'memory', level: 'ok', message: `${used}.` };
}

/**
 * Whether every process reports on time, the main one answers without
 * stalling, and every role the service needs has a process reporting.
 * @param views - the processes
 * @param options - the instant and what is expected
 * @returns the checks; one `ok` when nothing is wrong
 */
export function processChecks(
  views: readonly ProcessView[],
  options: ProcessCheckOptions,
): HealthCheck[] {
  const {
    now,
    expectedRoles = {},
    mainRole = 'server',
    slowEventLoopMs = 200,
  } = options;
  const checks: HealthCheck[] = [];
  for (const view of views) {
    if (view.stale) {
      checks.push({
        id: `process-${view.role}-${view.pid}`,
        level: 'error',
        message: `${view.role} (pid ${view.pid}) has not reported for ${Math.round((now - view.updatedAt) / 1000)} s: it stopped or hangs.`,
      });
    }
    if (view.role === mainRole && view.eventLoopDelayMs > slowEventLoopMs) {
      checks.push({
        id: 'event-loop',
        level: 'warning',
        message: `The ${mainRole}'s event loop stalls up to ${view.eventLoopDelayMs} ms: something synchronous runs on it.`,
      });
    }
  }
  for (const [role, consequence] of Object.entries(expectedRoles)) {
    if (views.every((view) => view.role !== role || view.stale)) {
      checks.push({
        id: `service-${role}`,
        level: 'warning',
        message: `No ${role} service is reporting: start it, or ${consequence}.`,
      });
    }
  }
  if (checks.length === 0) {
    checks.push({
      id: 'processes',
      level: 'ok',
      message: `${views.length} ${views.length === 1 ? 'process reports' : 'processes report'} on time.`,
    });
  }
  return checks;
}

/**
 * Whether errors were logged lately.
 * @param errors - how many errors were logged in the last hour
 * @param cap - the most that were counted, so `errors` may be more
 * @returns a warning, or nothing when none was
 */
export function logErrorsCheck(errors: number, cap = 1000): HealthCheck[] {
  if (errors === 0) return [];
  const count = errors >= cap ? `${cap} or more` : String(errors);
  return [
    {
      id: 'log-errors',
      level: 'warning',
      message: `${count} ${errors === 1 ? 'error was' : 'errors were'} logged in the last hour: read them under Logs.`,
    },
  ];
}
