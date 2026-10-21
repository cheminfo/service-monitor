import { expect, test } from 'vitest';

import {
  diskCheck,
  logErrorsCheck,
  memoryCheck,
  processChecks,
  sortChecks,
} from '../health/checks.ts';
import type { HostMetrics, ProcessView } from '../types.ts';

const NOW = 1_790_000_000_000;

/**
 * The machine, with a data volume and a container as given.
 * @param available - the bytes free of 100
 * @param memory - the container's memory
 * @returns the machine
 */
function host(
  available: number,
  memory: Partial<HostMetrics['memory']> = {},
): HostMetrics {
  return {
    hostname: 'host',
    uptimeSeconds: 10,
    cpu: {
      cores: 4,
      quota: null,
      load: [0, 0, 0],
      hostPercent: null,
      containerPercent: null,
    },
    memory: {
      total: 100,
      free: 50,
      containerUsed: null,
      containerLimit: null,
      ...memory,
    },
    disk: { total: 100, available },
  };
}

/**
 * A process, reporting on time unless told otherwise.
 * @param view - what differs from the server's
 * @returns the process
 */
function processView(view: Partial<ProcessView> = {}): ProcessView {
  return {
    role: 'server',
    pid: 7,
    hostname: 'host',
    startedAt: NOW - 60_000,
    updatedAt: NOW - 5000,
    intervalMs: 10_000,
    memory: { rss: 3, heapUsed: 1, heapTotal: 2 },
    cpuPercent: 1,
    eventLoopDelayMs: 2,
    activity: {},
    stale: false,
    ...view,
  };
}

test('the data volume warns as it fills, and fails near full', () => {
  expect([
    diskCheck(host(50)),
    diskCheck(host(10)),
    diskCheck(host(3)),
  ]).toStrictEqual([
    { id: 'disk', level: 'ok', message: '50% of the data volume is free.' },
    {
      id: 'disk',
      level: 'warning',
      message:
        '10% of the data volume is free. Plan more space before it fills.',
    },
    {
      id: 'disk',
      level: 'error',
      message:
        '3% of the data volume is free: writes will fail. Free space or grow the volume.',
    },
  ]);
});

test('a container near its memory limit is warned about', () => {
  expect(
    memoryCheck(host(50, { containerUsed: 95, containerLimit: 100 })),
  ).toStrictEqual({
    id: 'memory',
    level: 'warning',
    message:
      "The server's container uses 95% of its memory limit: it is killed when it reaches it. Raise mem_limit.",
  });
  expect(memoryCheck(host(50)).level).toBe('ok');
});

test('a silent process, a stalled loop and a missing service are each reported', () => {
  const checks = processChecks(
    [
      processView({ eventLoopDelayMs: 450 }),
      processView({
        role: 'import',
        pid: 9,
        stale: true,
        updatedAt: NOW - 45_000,
      }),
    ],
    { now: NOW, expectedRoles: { 'refresh-stats': 'nothing new is counted' } },
  );

  expect(checks).toStrictEqual([
    {
      id: 'event-loop',
      level: 'warning',
      message:
        "The server's event loop stalls up to 450 ms: something synchronous runs on it.",
    },
    {
      id: 'process-import-9',
      level: 'error',
      message: 'import (pid 9) has not reported for 45 s: it stopped or hangs.',
    },
    {
      id: 'service-refresh-stats',
      level: 'warning',
      message:
        'No refresh-stats service is reporting: start it, or nothing new is counted.',
    },
  ]);
  expect(processChecks([processView()], { now: NOW })).toStrictEqual([
    { id: 'processes', level: 'ok', message: '1 process reports on time.' },
  ]);
});

test('errors logged lately are counted, one alone, and a capped count says so', () => {
  expect(logErrorsCheck(0)).toStrictEqual([]);
  expect(logErrorsCheck(1)[0]?.message).toBe(
    '1 error was logged in the last hour: read them under Logs.',
  );
  expect(logErrorsCheck(1000)[0]?.message).toBe(
    '1000 or more errors were logged in the last hour: read them under Logs.',
  );
});

test('the worst checks come first, equal ones in their order', () => {
  expect(
    sortChecks([
      { id: 'a', level: 'ok', message: '' },
      { id: 'b', level: 'warning', message: '' },
      { id: 'c', level: 'error', message: '' },
      { id: 'd', level: 'warning', message: '' },
    ]).map((check) => check.id),
  ).toStrictEqual(['c', 'b', 'd', 'a']);
});
