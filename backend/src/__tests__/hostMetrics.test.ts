import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { readHostMetrics } from '../host/hostMetrics.ts';

test('a data directory not made yet is read on the volume it will be made on', () => {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitor-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const volume = statfsSync(directory);

  const { disk } = readHostMetrics(join(directory, 'data', 'sqlite'));

  expect(disk.total).toBe(volume.blocks * volume.bsize);
});

test("the cores are the machine's, whatever a container's quota allows", () => {
  expect(readHostMetrics(tmpdir()).cpu.cores).toBe(cpus().length);
});
