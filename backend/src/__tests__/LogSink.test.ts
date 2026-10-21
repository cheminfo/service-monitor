import { pino } from 'pino';
import { expect, onTestFinished, test, vi } from 'vitest';

import { LogSink } from '../logs/LogSink.ts';
import { MonitorStore } from '../store/MonitorStore.ts';

import { openStore } from './fixtures.ts';

/**
 * A pino logger writing to a sink only.
 * @param sink - the sink
 * @param name - the logger's name
 * @returns the logger
 */
function loggerOf(sink: LogSink, name?: string) {
  return pino({ name }, { write: (line: string) => sink.write(line) });
}

/**
 * Keep what is written to stderr until the calling test finishes.
 * @returns what was written, as it is
 */
function silenceStderr(): string[] {
  const said: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => {
    said.push(String(text));
    return true;
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  return said;
}

test('lines written before the store opens wait for it, and take the role', async () => {
  const sink = new LogSink();
  const logger = loggerOf(sink, 'indexer');
  logger.info('loading');
  logger.warn({ rows: 12 }, 'slow');

  const store = await openStore();
  await sink.attach(store, { role: 'server', pid: 99, hostname: 'box' });
  sink.detach();

  expect(
    store
      .queryLogs({})
      .logs.map(
        ({ topic, role, pid, hostname, message, levelLabel, meta }) => ({
          topic,
          role,
          pid,
          hostname,
          message,
          levelLabel,
          meta,
        }),
      ),
  ).toStrictEqual([
    {
      topic: 'indexer',
      role: 'server',
      pid: process.pid,
      hostname: expect.any(String),
      message: 'slow',
      levelLabel: 'warn',
      meta: { rows: 12 },
    },
    {
      topic: 'indexer',
      role: 'server',
      pid: process.pid,
      hostname: expect.any(String),
      message: 'loading',
      levelLabel: 'info',
      meta: null,
    },
  ]);
});

test('a full batch is written at once, the rest at the next flush', async () => {
  const sink = new LogSink({ batchSize: 3, flushIntervalMs: 60_000 });
  const store = await openStore();
  await sink.attach(store, { role: 'import' });
  const logger = loggerOf(sink);

  for (let line = 1; line <= 4; line++) logger.info(`line ${line}`);

  expect(store.queryLogs({}).logs.map((line) => line.message)).toStrictEqual([
    'line 3',
    'line 2',
    'line 1',
  ]);
  expect(sink.pendingCount).toBe(1);

  sink.detach();

  expect(store.queryLogs({}).logs).toHaveLength(4);
});

test('past the lines it may keep waiting, the oldest are dropped', () => {
  const sink = new LogSink({ maxPending: 2 });
  const logger = loggerOf(sink);
  for (let line = 1; line <= 5; line++) logger.info(`line ${line}`);

  expect(sink.pendingCount).toBe(2);
});

test('a store that cannot be written keeps the lines for the next try', async () => {
  const sink = new LogSink({ flushIntervalMs: 60_000 });
  const store = await MonitorStore.open(':memory:');
  await sink.attach(store, { role: 'server' });
  store.close();
  const said = silenceStderr();
  loggerOf(sink).error('lost?');
  sink.flush();
  sink.flush();

  expect(sink.pendingCount).toBe(1);
  expect(said).toHaveLength(1);
  expect(said[0]).toMatch(/^service-monitor: lines kept for the next try/);

  sink.detach();
});

test('a store that does not open leaves the lines to stdout', async () => {
  const sink = new LogSink();
  const said = silenceStderr();
  await sink.attach(Promise.reject(new Error('read-only volume')), {
    role: 'server',
  });

  expect(said).toStrictEqual([
    'service-monitor: the log store did not open, lines go to stdout only: Error: read-only volume\n',
  ]);
});
