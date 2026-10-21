import { expect, test } from 'vitest';

import type { ProcessStatus } from '../types.ts';

import { openStore } from './fixtures.ts';

const NOW = 1_790_000_000_000;

/**
 * What a process writes about itself.
 * @param status - what differs from the server's
 * @returns the status
 */
function status(status: Partial<ProcessStatus> = {}): ProcessStatus {
  return {
    role: 'server',
    pid: 7,
    hostname: 'host',
    startedAt: NOW - 60_000,
    updatedAt: NOW - 5000,
    intervalMs: 10_000,
    memory: { rss: 300, heapUsed: 100, heapTotal: 200 },
    cpuPercent: 12,
    eventLoopDelayMs: 3,
    activity: { indexRows: 1200, phase: 'loading', done: false },
    ...status,
  };
}

test('a process is read as it last wrote, and stale once it missed three beats', async () => {
  const store = await openStore();
  store.writeProcess(status({ updatedAt: NOW - 50_000 }));
  store.writeProcess(status({ updatedAt: NOW - 5000, cpuPercent: 40 }));
  store.writeProcess(
    status({ role: 'import', pid: 9, updatedAt: NOW - 31_000, activity: {} }),
  );

  expect(store.readProcesses(NOW)).toStrictEqual([
    {
      ...status({
        role: 'import',
        pid: 9,
        updatedAt: NOW - 31_000,
        activity: {},
      }),
      stale: true,
    },
    { ...status({ cpuPercent: 40 }), stale: false },
  ]);
});

test('a stopped process is forgotten, and one silent for a day is not read', async () => {
  const store = await openStore();
  store.writeProcess(status());
  store.writeProcess(status({ pid: 8, updatedAt: NOW - 25 * 3600 * 1000 }));
  store.removeProcess('host', 7);

  expect(store.readProcesses(NOW)).toStrictEqual([]);
});
