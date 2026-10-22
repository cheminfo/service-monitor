import type * as NodeFs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';

import { cpuQuota, readCgroupNumber } from '../host/cgroup.ts';
import { readHostMetrics } from '../host/hostMetrics.ts';

/** The cgroup files the machine of the next reading holds, by path. */
const cgroup = new Map<string, string>();

// Only the cgroup files are faked: the volume is still read off the disk.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>();
  return {
    ...fs,
    readFileSync: (path: string, encoding: BufferEncoding) => {
      if (!path.startsWith('/sys/fs/cgroup/')) {
        return fs.readFileSync(path, encoding);
      }
      const text = cgroup.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
});

beforeEach(() => {
  cgroup.clear();
});

test('a cgroup v2 quota is read in whole CPUs, rounded up, never below one', () => {
  const quotas = [];
  for (const line of ['200000 100000\n', '150000 100000', '20000 100000']) {
    cgroup.set('/sys/fs/cgroup/cpu.max', line);
    quotas.push(cpuQuota());
  }

  expect(quotas).toStrictEqual([2, 2, 1]);
});

test('an unlimited cgroup v2 falls back to v1, where -1 is unlimited too', () => {
  cgroup.set('/sys/fs/cgroup/cpu.max', 'max 100000');
  const unlimited = cpuQuota();
  cgroup.set('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', '300000');
  cgroup.set('/sys/fs/cgroup/cpu/cpu.cfs_period_us', '100000');
  const fromV1 = cpuQuota();
  cgroup.set('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', '-1');
  const unlimitedV1 = cpuQuota();

  expect([unlimited, fromV1, unlimitedV1]).toStrictEqual([
    undefined,
    3,
    undefined,
  ]);
});

test('a quota that makes no sense, or no cgroup at all, is no quota', () => {
  const answers = [cpuQuota()];
  for (const line of ['lots 100000', '100000 0', '100000 -5']) {
    cgroup.set('/sys/fs/cgroup/cpu.max', line);
    answers.push(cpuQuota());
  }

  expect(answers).toStrictEqual([undefined, undefined, undefined, undefined]);
});

test('a cgroup number is null when absent, unlimited or unreadable', () => {
  cgroup.set('/sys/fs/cgroup/memory.max', 'max');
  cgroup.set('/sys/fs/cgroup/memory.current', '536870912\n');
  cgroup.set('/sys/fs/cgroup/memory.high', 'a lot');

  expect([
    readCgroupNumber('/sys/fs/cgroup/memory.current'),
    readCgroupNumber('/sys/fs/cgroup/memory.max'),
    readCgroupNumber('/sys/fs/cgroup/memory.high'),
    readCgroupNumber('/sys/fs/cgroup/memory.swap.max'),
  ]).toStrictEqual([536_870_912, null, null, null]);
});

test("a container's memory and processor share are read from its cgroup", () => {
  cgroup.set('/sys/fs/cgroup/cpu.max', '100000 100000');
  cgroup.set('/sys/fs/cgroup/memory.current', '268435456');
  cgroup.set('/sys/fs/cgroup/memory.max', '536870912');
  cgroup.set('/sys/fs/cgroup/cpu.stat', 'usage_usec 1000000\nuser_usec 900000');
  // 20 ms pass between the two readings, 5 ms of which the container ran.
  const now = vi.spyOn(performance, 'now');
  onTestFinished(() => now.mockRestore());
  now.mockReturnValueOnce(1000);
  readHostMetrics(tmpdir());
  cgroup.set('/sys/fs/cgroup/cpu.stat', 'usage_usec 1005000\nuser_usec 900000');
  now.mockReturnValueOnce(1020);

  const host = readHostMetrics(tmpdir());

  expect(host.memory.containerUsed).toBe(268_435_456);
  expect(host.memory.containerLimit).toBe(536_870_912);
  expect(host.cpu.quota).toBe(1);
  expect(host.cpu.containerPercent).toBe(25);
});

test('a data directory under a file is an error, not a walk up to the root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'service-monitor-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'data'), '');

  expect(() => readHostMetrics(join(directory, 'data', 'sqlite'))).toThrow(
    /ENOTDIR/,
  );
});
