/**
 * The shapes the routes answer. The frontend package holds the same file: the
 * surface is small enough that a review catches the two drifting apart.
 */

/**
 * The levels a line can carry, as pino and fifo-logger name them.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * One line a process logged.
 */
export interface LogEntry {
  /**
   * Grows with every line written, whichever process wrote it.
   */
  id: number;
  /**
   * When it was written, in unix milliseconds.
   */
  at: number;
  /**
   * pino's number for the level: 10 trace, 20 debug … 60 fatal.
   */
  level: number;
  levelLabel: LogLevel;
  /**
   * What part of the service wrote it: the logger's name.
   */
  topic: string;
  /**
   * What the process is: `server`, `import`, …
   */
  role: string;
  pid: number;
  hostname: string;
  message: string;
  /**
   * The other fields of the line, an error's stack among them; null when it carried none.
   */
  meta: Record<string, unknown> | null;
}

/**
 * What `GET /logs` answers.
 */
export interface LogsResponse {
  /**
   * The newest first; the oldest first when the request gave `after`.
   */
  logs: LogEntry[];
  /**
   * The `before` that reads the next older page; null when there is none.
   */
  nextBefore: number | null;
  /**
   * Whether a text search stopped at the most recent lines it may read.
   */
  truncated: boolean;
}

/**
 * A topic or a role that has logged, and when it last did.
 */
export interface LogFacet {
  name: string;
  /**
   * Unix milliseconds.
   */
  lastAt: number;
}

/**
 * What `GET /logs/facets` answers: what the filters can offer.
 */
export interface LogFacetsResponse {
  topics: LogFacet[];
  roles: LogFacet[];
}

/**
 * What a process says it is doing: a few named figures or words.
 */
export type Activity = Record<string, string | number | boolean | null>;

/**
 * What one process writes about itself at every beat.
 */
export interface ProcessStatus {
  role: string;
  pid: number;
  /**
   * The machine, or the container, it runs in.
   */
  hostname: string;
  /**
   * Unix milliseconds.
   */
  startedAt: number;
  /**
   * Unix milliseconds.
   */
  updatedAt: number;
  /**
   * How often it writes, so a reader can tell a silent one from a slow one.
   */
  intervalMs: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  /**
   * Processor time since the last beat, threads included, in percent of one core.
   */
  cpuPercent: number;
  /**
   * The 99th percentile of event-loop delay since the last beat, in milliseconds.
   */
  eventLoopDelayMs: number;
  activity: Activity;
}

/**
 * A process, as a reader sees it.
 */
export interface ProcessView extends ProcessStatus {
  /**
   * Whether it missed three beats: stopped, killed or hung.
   */
  stale: boolean;
}

/**
 * What `GET /processes` answers.
 */
export interface ProcessesResponse {
  /**
   * Unix milliseconds, so every age is measured from one instant.
   */
  readAt: number;
  processes: ProcessView[];
}

/**
 * The machine, and the container the process runs in.
 */
export interface HostMetrics {
  hostname: string;
  /**
   * How long the machine has been up, in seconds.
   */
  uptimeSeconds: number;
  cpu: {
    /**
     * The cores the machine has.
     */
    cores: number;
    /**
     * The cores the container may use, or null outside a quota.
     */
    quota: number | null;
    /**
     * The 1, 5 and 15 minute load averages of the machine.
     */
    load: [number, number, number];
    /**
     * How busy every core was since the last reading, in percent; null on the first.
     */
    hostPercent: number | null;
    /**
     * How busy the container was since the last reading, in percent of one core; null outside a cgroup or on the first.
     */
    containerPercent: number | null;
  };
  memory: {
    /**
     * In bytes.
     */
    total: number;
    /**
     * What the machine can still give, in bytes: on Linux `MemAvailable`, so
     * the page cache the kernel can reclaim counts as free.
     */
    free: number;
    /**
     * What the container uses, in bytes, or null outside a cgroup.
     */
    containerUsed: number | null;
    /**
     * What the container may use, in bytes, or null when unlimited.
     */
    containerLimit: number | null;
  };
  disk: {
    /**
     * The data volume, in bytes.
     */
    total: number;
    /**
     * What is left on it for this process, in bytes.
     */
    available: number;
  };
}

/**
 * One judgement of the service.
 */
export interface HealthCheck {
  /**
   * Stable, so a test or a probe can look for it.
   */
  id: string;
  level: 'ok' | 'info' | 'warning' | 'error';
  /**
   * One sentence: what was found, and what to do about it.
   */
  message: string;
}

/**
 * What `GET /status` answers: everything a monitor page shows but the lines,
 * read at one instant.
 */
export interface MonitorStatus {
  /**
   * Unix milliseconds, so every age is measured from one instant.
   */
  readAt: number;
  /**
   * The judgements, the worst first.
   */
  checks: HealthCheck[];
  host: HostMetrics;
  processes: ProcessView[];
}
