import type { StatsFs } from 'node:fs';
import { statfsSync } from 'node:fs';
import { cpus, freemem, hostname, loadavg, totalmem, uptime } from 'node:os';
import { dirname, resolve } from 'node:path';

import type { HostMetrics } from '../types.ts';

import { cpuQuota, readCgroupNumber, readCgroupText } from './cgroup.ts';

/**
 * The last processor reading, which the next one is measured against.
 */
const last: {
  reading?: {
    at: number;
    idle: number;
    busy: number;
    containerUsec: number | null;
  };
} = {};

/**
 * Read the machine's and the container's processor, memory and disk.
 *
 * A processor share needs two readings, so it is measured since the previous
 * call: a page that asks every few seconds gets the share over those seconds.
 * @param dataDirectory - a path on the volume whose free space is reported
 * @returns the figures
 */
export function readHostMetrics(dataDirectory: string): HostMetrics {
  const { idle, busy } = processorTimes();
  const containerUsec = containerCpuUsec();
  const at = performance.now();

  let hostPercent: number | null = null;
  let containerPercent: number | null = null;
  const previous = last.reading;
  if (previous !== undefined) {
    const total = idle - previous.idle + busy - previous.busy;
    if (total > 0) hostPercent = round((100 * (busy - previous.busy)) / total);
    if (containerUsec !== null && previous.containerUsec !== null) {
      const elapsedUsec = (at - previous.at) * 1000;
      if (elapsedUsec > 0) {
        containerPercent = round(
          (100 * (containerUsec - previous.containerUsec)) / elapsedUsec,
        );
      }
    }
  }
  last.reading = { at, idle, busy, containerUsec };

  const disk = volumeOf(dataDirectory);
  return {
    hostname: hostname(),
    uptimeSeconds: Math.round(uptime()),
    cpu: {
      // The machine's, not the quota's: availableParallelism() already counts
      // the cores a container's quota allows, which `quota` reports.
      cores: cpus().length,
      quota: cpuQuota() ?? null,
      load: loadavg().map(round) as [number, number, number],
      hostPercent,
      containerPercent,
    },
    memory: {
      total: totalmem(),
      free: freemem(),
      containerUsed: readCgroupNumber('/sys/fs/cgroup/memory.current'),
      containerLimit: readCgroupNumber('/sys/fs/cgroup/memory.max'),
    },
    disk: {
      total: disk.blocks * disk.bsize,
      available: disk.bavail * disk.bsize,
    },
  };
}

/**
 * The volume a path is on, read at the nearest directory that exists: the
 * data directory of a fresh checkout, or of a test, may not be made yet.
 * @param path - the path
 * @returns the volume's figures
 */
function volumeOf(path: string): StatsFs {
  let current = resolve(path);
  for (;;) {
    try {
      return statfsSync(current);
    } catch (error: unknown) {
      const parent = dirname(current);
      if (
        (error as { code?: unknown }).code !== 'ENOENT' ||
        parent === current
      ) {
        throw error;
      }
      current = parent;
    }
  }
}

/**
 * The time every core of the machine spent idle and busy since it started.
 * @returns both, in milliseconds
 */
function processorTimes(): { idle: number; busy: number } {
  let idle = 0;
  let busy = 0;
  for (const cpu of cpus()) {
    const { user, nice, sys, irq } = cpu.times;
    idle += cpu.times.idle;
    busy += user + nice + sys + irq;
  }
  return { idle, busy };
}

/**
 * The processor time the container used since it started, as cgroup v2
 * counts it.
 * @returns microseconds, or null outside a cgroup
 */
function containerCpuUsec(): number | null {
  const stat = readCgroupText('/sys/fs/cgroup/cpu.stat');
  const match = stat?.match(/^usage_usec (?<usec>\d+)$/m);
  return match?.groups?.usec === undefined ? null : Number(match.groups.usec);
}

/**
 * A figure to one decimal.
 * @param value - the figure
 * @returns it, rounded
 */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
