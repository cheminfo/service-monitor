import { expect, test } from 'vitest';

import { logRow, openStore } from './fixtures.ts';

const NOW = 1_790_000_000_000;

test('a page holds the newest lines first, and says where the next starts', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW, message: 'first' }),
    logRow({ at: NOW + 1, message: 'second' }),
    logRow({ at: NOW + 2, message: 'third', meta: '{"rows":12}' }),
  ]);

  const page = store.queryLogs({ limit: 2 });

  expect(page).toStrictEqual({
    logs: [
      {
        id: 3,
        at: NOW + 2,
        level: 30,
        levelLabel: 'info',
        topic: 'main',
        role: 'server',
        pid: 7,
        hostname: 'host',
        message: 'third',
        meta: { rows: 12 },
      },
      expect.objectContaining({ id: 2, message: 'second', meta: null }),
    ],
    nextBefore: 2,
    truncated: false,
  });
  expect(store.queryLogs({ limit: 2, before: 2 })).toStrictEqual({
    logs: [expect.objectContaining({ id: 1, message: 'first' })],
    nextBefore: null,
    truncated: false,
  });
});

test('lines are read by the least severe level, by topic and by role', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ level: 30, topic: 'http', message: 'GET /' }),
    logRow({ level: 40, topic: 'writeQueue', message: 'busy' }),
    logRow({ level: 50, topic: 'import', role: 'import', message: 'failed' }),
    logRow({ level: 60, topic: 'http', message: 'crashed' }),
  ]);
  const messages = (query: Parameters<typeof store.queryLogs>[0]) =>
    store.queryLogs(query).logs.map((line) => line.message);

  expect(messages({ minLevel: 'warn' })).toStrictEqual([
    'crashed',
    'failed',
    'busy',
  ]);
  expect(messages({ minLevel: 'error' })).toStrictEqual(['crashed', 'failed']);
  expect(messages({ topics: ['http'] })).toStrictEqual(['crashed', 'GET /']);
  expect(messages({ topics: ['http', 'import'] })).toStrictEqual([
    'crashed',
    'failed',
    'GET /',
  ]);
  expect(messages({ roles: ['import'] })).toStrictEqual(['failed']);
  expect(messages({ topics: ['http'], minLevel: 'warn' })).toStrictEqual([
    'crashed',
  ]);
});

test('a text search matches either case, and its wildcards literally', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ message: 'Imported 100% of PubChem' }),
    logRow({ message: 'imported 12 entries' }),
    logRow({ message: 'import_failed' }),
    logRow({ message: 'importXfailed' }),
  ]);
  const messages = (text: string) =>
    store.queryLogs({ text }).logs.map((line) => line.message);

  expect(messages('IMPORTED')).toStrictEqual([
    'imported 12 entries',
    'Imported 100% of PubChem',
  ]);
  expect(messages('100%')).toStrictEqual(['Imported 100% of PubChem']);
  expect(messages('import_')).toStrictEqual(['import_failed']);
});

test('a text search reads the most recent lines only, and says so', async () => {
  const store = await openStore(3);
  store.insertLogs(
    Array.from({ length: 5 }, (_, index) =>
      logRow({ message: `batch ${index + 1}` }),
    ),
  );

  expect(store.queryLogs({ text: 'batch' })).toStrictEqual({
    logs: [
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ id: 4 }),
      expect.objectContaining({ id: 3 }),
    ],
    nextBefore: null,
    truncated: true,
  });
  expect(store.queryLogs({ text: 'nothing' }).truncated).toBe(true);
});

test('the lines written since one are read the oldest first', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ message: 'seen' }),
    logRow({ message: 'new' }),
    logRow({ message: 'newer' }),
  ]);

  const since = store.queryLogs({ after: 1 });

  expect(since.logs.map((line) => line.id)).toStrictEqual([2, 3]);
  expect(since.nextBefore).toBeNull();
});

test('the topics and roles that logged are listed with their last line', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW, topic: 'http' }),
    logRow({ at: NOW + 5, topic: 'http', role: 'import' }),
    logRow({ at: NOW + 2, topic: 'checkpointer' }),
  ]);
  store.insertLogs([logRow({ at: NOW + 1, topic: 'http' })]);

  expect(store.logFacets()).toStrictEqual({
    topics: [
      { name: 'checkpointer', lastAt: NOW + 2 },
      { name: 'http', lastAt: NOW + 5 },
    ],
    roles: [
      { name: 'import', lastAt: NOW + 5 },
      { name: 'server', lastAt: NOW + 2 },
    ],
  });
});

test('recent problems are counted from the newest, up to a cap', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ at: NOW - 7_200_000, level: 50 }),
    logRow({ at: NOW - 60_000, level: 50 }),
    logRow({ at: NOW - 30_000, level: 60 }),
    logRow({ at: NOW - 10_000, level: 40 }),
  ]);

  expect(store.countRecentLogs('error', NOW - 3_600_000)).toBe(2);
  expect(store.countRecentLogs('warn', NOW - 3_600_000)).toBe(3);
  expect(store.countRecentLogs('error', NOW - 3_600_000, 1)).toBe(1);
});
