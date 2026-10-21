import { hostname } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { MonitorStore } from './store/MonitorStore.ts';
import type { Activity, ProcessStatus } from './types.ts';

/**
 * How a process reports.
 */
export interface HeartbeatOptions {
  /**
   * The store, or its opening: beats before it opens are skipped.
   */
  store: MonitorStore | Promise<MonitorStore>;
  /**
   * What the process is: `server`, `import`, …
   */
  role: string;
  /**
   * Read at every beat, for figures the process does not push itself; merged
   * over `activity`.
   * @default undefined
   */
  readActivity?: () => Activity;
  /**
   * How often the process writes its status, in milliseconds.
   * @default 10000
   */
  intervalMs?: number;
}

/**
 * A running heartbeat.
 */
export interface Heartbeat {
  /**
   * What the process is doing; written with the next beat.
   */
  activity: Activity;
  /**
   * Write the status now, rather than at the next beat.
   */
  beat: () => void;
  /**
   * Stop, and remove the status, so the process is not shown as stalled.
   */
  stop: () => void;
}

/**
 * Write this process's status to the store at every beat, until it stops:
 * its memory, processor share, event-loop delay and what it says it is
 * doing. A process that died without stopping is told apart by the age of
 * its status.
 * @param options - the store, the role and the activity
 * @returns the heartbeat, whose `activity` the process keeps up to date
 */
export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
  const { role, readActivity, intervalMs = 10_000 } = options;
  const host = hostname();
  const startedAt = Date.now();
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let store: MonitorStore | undefined;
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  let isStopped = false;

  const heartbeat: Heartbeat = {
    activity: {},
    beat: () => {
      if (isStopped || store === undefined) return;
      const now = performance.now();
      const cpu = process.cpuUsage(lastCpu);
      const cpuPercent =
        ((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastAt)) * 100;
      lastCpu = process.cpuUsage();
      lastAt = now;
      const { rss, heapUsed, heapTotal } = process.memoryUsage();
      const status: ProcessStatus = {
        role,
        pid: process.pid,
        hostname: host,
        startedAt,
        updatedAt: Date.now(),
        intervalMs,
        memory: { rss, heapUsed, heapTotal },
        cpuPercent: Math.round(cpuPercent),
        eventLoopDelayMs: Math.round(delay.percentile(99) / 1e6),
        activity: { ...heartbeat.activity, ...readActivity?.() },
      };
      delay.reset();
      try {
        store.writeProcess(status);
      } catch {
        // A status that cannot be written is a page that says less, not a
        // reason to stop the work.
      }
    },
    stop: () => {
      if (isStopped) return;
      isStopped = true;
      clearInterval(timer);
      delay.disable();
      try {
        store?.removeProcess(host, process.pid);
      } catch {
        // Gone with the store: the row ages out.
      }
    },
  };

  const timer = setInterval(heartbeat.beat, intervalMs).unref();
  void Promise.resolve(options.store)
    .then((opened) => {
      store = opened;
      heartbeat.beat();
    })
    .catch(() => {
      // No store, no status: the process works on regardless.
    });
  process.once('exit', heartbeat.stop);
  // A signal ends a process without 'exit' when nothing else listens for it,
  // which would leave a stopped process shown as one that hangs.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      heartbeat.stop();
      if (process.listenerCount(signal) === 0) {
        process.kill(process.pid, signal);
      }
    });
  }
  return heartbeat;
}
