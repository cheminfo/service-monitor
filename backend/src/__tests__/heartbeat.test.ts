import { hostname } from 'node:os';

import { expect, test, vi } from 'vitest';

import { startHeartbeat } from '../heartbeat.ts';

import { openStore } from './fixtures.ts';

test('a process reports its status and activity, and is forgotten once stopped', async () => {
  const store = await openStore();
  const heartbeat = startHeartbeat({
    store: Promise.resolve(store),
    role: 'import',
    readActivity: () => ({ phase: 'parsing' }),
    intervalMs: 60_000,
  });
  heartbeat.activity.entries = 12;
  await vi.waitFor(() => {
    expect(store.readProcesses(Date.now())).toHaveLength(1);
  });
  heartbeat.beat();

  const [reported] = store.readProcesses(Date.now());

  expect(reported).toMatchObject({
    role: 'import',
    pid: process.pid,
    hostname: hostname(),
    intervalMs: 60_000,
    activity: { entries: 12, phase: 'parsing' },
    stale: false,
  });

  heartbeat.stop();

  expect(store.readProcesses(Date.now())).toStrictEqual([]);
});

test('a store that never opens leaves the process working', async () => {
  const heartbeat = startHeartbeat({
    store: Promise.reject(new Error('no volume')),
    role: 'server',
    intervalMs: 60_000,
  });
  await Promise.resolve();

  expect(() => heartbeat.beat()).not.toThrow();

  heartbeat.stop();
});
