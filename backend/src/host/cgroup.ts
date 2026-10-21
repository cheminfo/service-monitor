import { readFileSync } from 'node:fs';

/**
 * The CPU allowance of the cgroup this process runs in. A cgroup does not
 * virtualise `/proc/cpuinfo`, so `availableParallelism()` reports the cores of
 * the machine rather than the quota the process is held to.
 * @returns the number of CPUs, or undefined outside a quota
 */
export function cpuQuota(): number | undefined {
  // cgroup v2 writes "<quota> <period>", and "max <period>" when unlimited.
  const parts = readCgroupText('/sys/fs/cgroup/cpu.max')?.split(' ');
  if (parts?.length === 2 && parts[0] !== 'max') {
    return cpusOf(Number(parts[0]), Number(parts[1]));
  }
  // cgroup v1, where -1 is unlimited.
  const quota = Number(readCgroupText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = Number(readCgroupText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  return quota > 0 ? cpusOf(quota, period) : undefined;
}

/**
 * Read a cgroup file, which is absent on a machine that has no cgroups.
 * @param path - the file to read
 * @returns its contents, trimmed, or undefined when it cannot be read
 */
export function readCgroupText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
}

/**
 * A number a cgroup file holds.
 * @param path - the file
 * @returns it, or null when the file is absent or says `max`
 */
export function readCgroupNumber(path: string): number | null {
  const text = readCgroupText(path);
  if (text === undefined || text === 'max') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Turn a quota and a period into whole CPUs.
 * @param quota - the microseconds the cgroup may run per period
 * @param period - the length of the period, in microseconds
 * @returns the number of CPUs, or undefined when the pair makes no sense
 */
function cpusOf(quota: number, period: number): number | undefined {
  if (!Number.isFinite(quota) || !Number.isFinite(period) || period <= 0) {
    return undefined;
  }
  return Math.max(1, Math.ceil(quota / period));
}
