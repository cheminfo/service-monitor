import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { monitorStoreOpener } from '../store/monitorStoreOpener.ts';

/**
 * A directory removed when the calling test finishes.
 * @returns its path
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitor-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('every caller shares one opening, in a directory created for it', async () => {
  const open = monitorStoreOpener(
    join(temporaryDirectory(), 'data', 'sqlite', 'monitor.sqlite'),
  );

  const [first, second] = await Promise.all([open(), open()]);
  onTestFinished(() => first.close());

  expect(second).toBe(first);
  await expect(open()).resolves.toBe(first);
});

test('an opening that failed is tried again at the next call', async () => {
  const directory = temporaryDirectory();
  // A file where the directory should be: no store can be made under it.
  writeFileSync(join(directory, 'data'), '');
  const open = monitorStoreOpener(join(directory, 'data', 'monitor.sqlite'));

  await expect(open()).rejects.toThrow(/ENOTDIR|EEXIST/);

  rmSync(join(directory, 'data'));
  const store = await open();
  onTestFinished(() => store.close());

  expect(store.queryLogs({}).logs).toStrictEqual([]);
});
