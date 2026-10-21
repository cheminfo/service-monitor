import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, onTestFinished, test } from 'vitest';

import { MonitorStore } from '../store/MonitorStore.ts';
import { SCHEMA_TABLE } from '../store/migrate.ts';

import { logRow } from './fixtures.ts';

/**
 * A file in a directory removed when the calling test finishes.
 * @returns its path
 */
function temporaryFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitor-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'monitor.sqlite');
}

test('every process writes to one file, each through its own connection', async () => {
  const path = temporaryFile();
  const [server, importer] = await Promise.all([
    MonitorStore.open(path),
    MonitorStore.open(path),
  ]);
  server.insertLogs([logRow({ role: 'server', message: 'listening' })]);
  importer.insertLogs([logRow({ role: 'import', message: 'batch 1' })]);
  server.insertLogs([logRow({ role: 'server', message: 'GET /' })]);
  importer.close();

  expect(
    server.queryLogs({}).logs.map((line) => [line.role, line.message]),
  ).toStrictEqual([
    ['server', 'GET /'],
    ['import', 'batch 1'],
    ['server', 'listening'],
  ]);

  server.close();
});

test("the host's own tables and migrations live in the same file", async () => {
  const path = temporaryFile();
  const host = new DatabaseSync(path);
  host.exec(`
    CREATE TABLE schemaversion (version INTEGER, name TEXT, md5 TEXT, run_at TEXT);
    INSERT INTO schemaversion VALUES (2, 'samples', 'x', '2026-10-01');
    CREATE TABLE samples (at INTEGER PRIMARY KEY);
  `);

  const store = await MonitorStore.open(path);
  store.close();

  const hostVersion = host
    .prepare('SELECT max(version) AS version FROM schemaversion')
    .get()?.version;
  const storeVersion = host
    .prepare('SELECT max(version) AS version FROM service_monitor_version')
    .get()?.version;

  expect(SCHEMA_TABLE).toBe('service_monitor_version');
  expect([hostVersion, storeVersion]).toStrictEqual([2, 1]);

  host.close();
});
