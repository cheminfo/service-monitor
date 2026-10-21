import { expect, test } from 'vitest';

import { logRow, openStore } from './fixtures.ts';

const NOW = 1_790_000_000_000;
const DAY = 24 * 3600 * 1000;

test('routine lines go after a week, problems after ninety days', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW - 100 * DAY, level: 50, message: 'ancient error' }),
    logRow({ at: NOW - 30 * DAY, level: 40, message: 'old warning' }),
    logRow({ at: NOW - 8 * DAY, level: 30, message: 'old info' }),
    logRow({ at: NOW - 6 * DAY, level: 30, message: 'recent info' }),
    logRow({ at: NOW, level: 20, message: 'now' }),
  ]);

  const deleted = await store.prune(NOW);

  expect(deleted).toBe(2);
  expect(store.queryLogs({}).logs.map((line) => line.message)).toStrictEqual([
    'now',
    'recent info',
    'old warning',
  ]);
});

test('past the most routine lines kept, the oldest go whatever their age', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW, level: 50, message: 'error' }),
    ...Array.from({ length: 6 }, (_, index) =>
      logRow({ at: NOW, message: `request ${index + 1}` }),
    ),
  ]);

  await store.prune(NOW, { maxRoutineLines: 3 });

  expect(store.queryLogs({}).logs.map((line) => line.message)).toStrictEqual([
    'request 6',
    'request 5',
    'request 4',
    'error',
  ]);
});

test('more lines than one chunk are all deleted', async () => {
  const store = await openStore();
  store.insertLogs(
    Array.from({ length: 12_000 }, () => logRow({ at: NOW - 8 * DAY })),
  );

  await expect(store.prune(NOW)).resolves.toBe(12_000);
  expect(store.queryLogs({}).logs).toStrictEqual([]);
});

test('topics and roles that have not logged for the longest retention are forgotten', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW - 91 * DAY, level: 50, topic: 'gone', role: 'migrate' }),
    logRow({ at: NOW, topic: 'http' }),
  ]);

  await store.prune(NOW);

  expect(store.logFacets()).toStrictEqual({
    topics: [{ name: 'http', lastAt: NOW }],
    roles: [{ name: 'server', lastAt: NOW }],
  });
});
