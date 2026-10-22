import type {
  HostMetrics,
  LogEntry,
  LogsResponse,
  MonitorStatus,
  ProcessView,
} from '../types.ts';

/**
 * Where the tests mount the monitor's routes.
 */
export const BASE_PATH = '/v1/monitor';

/**
 * 21 October 2026, 14:03:07 in the local time zone: the instant every reading
 * of the tests is made at, so a line of that day shows its time alone.
 */
export const NOW = new Date(2026, 9, 21, 14, 3, 7).getTime();

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/**
 * A line the server logged.
 * @param id - its id
 * @param fields - what differs from an info line of the http topic
 * @returns the line
 */
export function logLine(id: number, fields: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    at: NOW - 2000,
    level: 30,
    levelLabel: 'info',
    topic: 'http',
    role: 'server',
    pid: 4012,
    hostname: 'web-1',
    message: `request ${id}`,
    meta: null,
    ...fields,
  };
}

/**
 * A page of lines, with nothing older and no search cut short.
 * @param logs - the lines
 * @param fields - what differs
 * @returns what `GET /logs` answers
 */
export function logsPage(
  logs: LogEntry[],
  fields: Partial<LogsResponse> = {},
): LogsResponse {
  return { logs, nextBefore: null, truncated: false, ...fields };
}

/**
 * A machine outside any container, its data volume 88 % full.
 */
export const HOST: HostMetrics = {
  hostname: 'web-1',
  uptimeSeconds: 3 * 86_400 + 4 * 3600 + 5 * 60,
  cpu: {
    cores: 16,
    quota: null,
    load: [2.4, 1.8, 1.2],
    hostPercent: 21.5,
    containerPercent: null,
  },
  memory: {
    total: 64 * GIB,
    free: 24 * GIB,
    containerUsed: null,
    containerLimit: null,
  },
  disk: { total: 500 * GIB, available: 60 * GIB },
};

/**
 * The web server, reporting.
 */
export const SERVER: ProcessView = {
  role: 'server',
  pid: 4012,
  hostname: 'web-1',
  startedAt: NOW - (2 * 3600 + 5 * 60) * 1000,
  updatedAt: NOW - 3000,
  intervalMs: 5000,
  memory: { rss: 180 * MIB, heapUsed: 64 * MIB, heapTotal: 96 * MIB },
  cpuPercent: 4,
  eventLoopDelayMs: 12,
  activity: { requests: 1204 },
  stale: false,
};

/**
 * An import that went silent twenty minutes ago.
 */
export const IMPORT: ProcessView = {
  role: 'import',
  pid: 4100,
  hostname: 'worker-1',
  startedAt: NOW - 45_000,
  updatedAt: NOW - 20 * 60_000,
  intervalMs: 5000,
  memory: { rss: 1.5 * GIB, heapUsed: 900 * MIB, heapTotal: 1.2 * GIB },
  cpuPercent: 97,
  eventLoopDelayMs: 1850,
  activity: { phase: 'parsing', parsedMs: 90_000, entries: null },
  stale: true,
};

/**
 * What `GET /status` answers: a warning, a check found fine, the machine and
 * two processes.
 */
export const STATUS: MonitorStatus = {
  readAt: NOW,
  checks: [
    {
      id: 'disk',
      level: 'warning',
      message: '12% of the data volume is free: make room before it fills.',
    },
    { id: 'processes', level: 'ok', message: 'Every process reports.' },
  ],
  host: HOST,
  processes: [SERVER, IMPORT],
};

/**
 * A refusal, as the routes write one.
 * @param status - the HTTP status
 * @param message - what it says went wrong
 * @returns the response
 */
export function refusal(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

/**
 * A fetch answering from fixtures, and the addresses it was asked for.
 */
export interface FakeMonitor {
  fetcher: typeof fetch;
  /**
   * Every address asked, path and query, in the order asked.
   */
  asked: string[];
}

/**
 * A monitor that answers without a network.
 * @param answer - what a route answers to a query: a body sent as JSON, a
 *   `Response`, or a promise of either to hold the answer back
 * @returns the fetch, and what it was asked
 */
export function fakeMonitor(
  answer: (route: string, query: URLSearchParams) => unknown,
): FakeMonitor {
  const asked: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === 'string' ? input : '/not-a-string',
      'http://localhost',
    );
    asked.push(`${url.pathname}${url.search}`);
    const body: unknown = await answer(
      url.pathname.slice(BASE_PATH.length),
      url.searchParams,
    );
    return body instanceof Response ? body : Response.json(body);
  };
  return { fetcher, asked };
}

/**
 * An answer held back until the test lets it go.
 */
export interface HeldAnswer {
  promise: Promise<unknown>;
  release: (body: unknown) => void;
}

/**
 * An answer to hold back.
 * @returns the promise to answer with, and what lets it go
 */
export function heldAnswer(): HeldAnswer {
  const held: { release: (body: unknown) => void } = {
    release: () => undefined,
  };
  const promise = new Promise<unknown>((resolve) => {
    held.release = resolve;
  });
  return { promise, release: (body) => held.release(body) };
}
