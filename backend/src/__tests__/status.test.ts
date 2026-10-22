import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, onTestFinished, test } from 'vitest';

import { readMonitorStatus } from '../health/status.ts';
import { MonitorStore } from '../store/MonitorStore.ts';

/**
 * A store in memory, closed when the test finishes.
 * @returns the store
 */
async function memoryStore(): Promise<MonitorStore> {
  const store = await MonitorStore.open(':memory:');
  onTestFinished(() => store.close());
  return store;
}

test("the host's own checks are listed with the generic ones, and read what they are given", async () => {
  const store = await memoryStore();
  const given: string[] = [];

  const status = await readMonitorStatus(store, {
    dataDirectory: tmpdir(),
    checks: ({ processes, host, now }) => {
      given.push(
        typeof now,
        typeof host.hostname,
        `${processes.length} processes`,
      );
      return [{ id: 'queue', level: 'warning', message: '12 imports wait.' }];
    },
  });

  expect(given).toStrictEqual(['number', 'string', '0 processes']);
  expect(status.checks.find((check) => check.id === 'queue')).toStrictEqual({
    id: 'queue',
    level: 'warning',
    message: '12 imports wait.',
  });
});

test('a host check that throws something other than an error is still said', async () => {
  const store = await memoryStore();

  const status = await readMonitorStatus(store, {
    dataDirectory: tmpdir(),
    checks: () => Promise.reject(new Error('the queue is gone')),
  });
  const thrown = await readMonitorStatus(store, {
    dataDirectory: tmpdir(),
    checks: () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a host may throw anything
      throw 'locked';
    },
  });

  expect(status.checks.find((check) => check.id === 'checks')?.message).toBe(
    "The service's own checks failed: the queue is gone.",
  );
  expect(thrown.checks.find((check) => check.id === 'checks')?.message).toBe(
    "The service's own checks failed: locked.",
  );
});

test('a file the store cannot migrate is closed again and the error thrown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitor-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'monitor.sqlite');
  // A table of the store's name, but of another shape: its migration fails.
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE logs (other TEXT)');
  database.close();

  await expect(MonitorStore.open(path)).rejects.toThrow(/logs/);

  // Closed, so the file can be opened again, and still holds only its table.
  const reopened = new DatabaseSync(path);
  onTestFinished(() => reopened.close());

  expect(
    reopened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  ).toStrictEqual(['logs']);
});

test('lines that cannot all be kept are kept not at all', async () => {
  const store = await memoryStore();
  const line = {
    at: 1,
    level: 30,
    topic: 'server',
    role: 'server',
    pid: 1,
    hostname: 'host',
    message: 'kept',
    meta: null,
  };

  expect(() =>
    store.insertLogs([
      line,
      { ...line, message: 'not a level', level: Number.NaN },
    ]),
  ).toThrow('NOT NULL constraint failed: logs.level');
  expect(store.queryLogs({}).logs).toStrictEqual([]);
});
