import { hostname } from 'node:os';

import type { MonitorStore } from '../store/MonitorStore.ts';
import type { LogRow } from '../store/statements.ts';

import type { ParsedLine } from './parseLogLine.ts';
import { parseLogLine } from './parseLogLine.ts';

/**
 * Which process the lines come from.
 */
export interface ProcessIdentity {
  /**
   * What the process is: `server`, `import`, …
   */
  role: string;
  /**
   * @default process.pid
   */
  pid?: number;
  /**
   * @default os.hostname()
   */
  hostname?: string;
}

/**
 * How a sink writes.
 */
export interface LogSinkOptions {
  /**
   * How often the lines waiting are written, in milliseconds.
   * @default 1000
   */
  flushIntervalMs?: number;
  /**
   * Lines waiting that are written at once rather than at the next tick.
   * @default 500
   */
  batchSize?: number;
  /**
   * The most lines kept waiting, before a store is attached or while it is
   * busy; past it the oldest are dropped.
   * @default 10000
   */
  maxPending?: number;
  /**
   * The topic of a line whose logger has no name.
   * @default 'main'
   */
  defaultTopic?: string;
}

/**
 * A pino destination that keeps every line in the monitor store, a batch a
 * second, in one transaction. Give it to `pino.multistream` beside stdout:
 * stdout stays the container's log, and the store is what every process of the
 * service shares.
 *
 * Lines written before the store is attached wait for it, so a logger made
 * when a module loads loses nothing said before the process knows its role.
 * Writing never throws: a store that cannot be written keeps the lines for
 * the next tick, and stdout has them regardless.
 */
export class LogSink {
  readonly #flushIntervalMs: number;
  readonly #batchSize: number;
  readonly #maxPending: number;
  readonly #defaultTopic: string;
  #pending: ParsedLine[] = [];
  #store: MonitorStore | undefined;
  #identity: Required<ProcessIdentity> | undefined;
  #timer: NodeJS.Timeout | undefined;
  #failing = false;
  readonly #flushOnExit = () => this.flush();

  /**
   * A sink, attached to no store yet.
   * @param options - how it writes
   */
  constructor(options: LogSinkOptions = {}) {
    this.#flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.#batchSize = options.batchSize ?? 500;
    this.#maxPending = options.maxPending ?? 10_000;
    this.#defaultTopic = options.defaultTopic ?? 'main';
  }

  /**
   * Take a line, as pino serialised it. Several lines in one string are
   * taken one by one.
   * @param text - the line
   */
  write(text: string): void {
    const now = Date.now();
    for (const line of text.split('\n')) {
      const parsed = parseLogLine(line, this.#defaultTopic, now);
      if (parsed === undefined) continue;
      this.#pending.push(parsed);
    }
    if (this.#pending.length > this.#maxPending) {
      this.#pending.splice(0, this.#pending.length - this.#maxPending);
    }
    if (this.#store !== undefined && this.#pending.length >= this.#batchSize) {
      this.flush();
    }
  }

  /**
   * Start writing to a store, as a process: the lines waiting first.
   * @param store - the store, or its opening
   * @param identity - the process
   * @returns once the store is open; never rejects
   */
  async attach(
    store: MonitorStore | Promise<MonitorStore>,
    identity: ProcessIdentity,
  ): Promise<void> {
    this.#identity = {
      role: identity.role,
      pid: identity.pid ?? process.pid,
      hostname: identity.hostname ?? hostname(),
    };
    try {
      this.#store = await store;
    } catch (error: unknown) {
      process.stderr.write(
        `service-monitor: the log store did not open, lines go to stdout only: ${String(error)}\n`,
      );
      return;
    }
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.flush(), this.#flushIntervalMs);
    this.#timer.unref();
    process.off('exit', this.#flushOnExit);
    process.once('exit', this.#flushOnExit);
    this.flush();
  }

  /**
   * Write the lines waiting, if a store is attached.
   */
  flush(): void {
    const store = this.#store;
    const identity = this.#identity;
    if (
      store === undefined ||
      identity === undefined ||
      this.#pending.length === 0
    ) {
      return;
    }
    const rows: LogRow[] = this.#pending.map((line) => ({
      at: line.at,
      level: line.level,
      topic: line.topic,
      role: identity.role,
      pid: line.pid ?? identity.pid,
      hostname: line.hostname ?? identity.hostname,
      message: line.message,
      meta: line.meta,
    }));
    try {
      store.insertLogs(rows);
      this.#pending = [];
      this.#failing = false;
    } catch (error: unknown) {
      // Said once per spell, not at every tick.
      if (!this.#failing) {
        process.stderr.write(
          `service-monitor: lines kept for the next try: ${String(error)}\n`,
        );
      }
      this.#failing = true;
    }
  }

  /**
   * Write the lines waiting, then stop writing to the store.
   */
  detach(): void {
    this.flush();
    clearInterval(this.#timer);
    this.#timer = undefined;
    process.off('exit', this.#flushOnExit);
    this.#store = undefined;
  }

  /**
   * How many lines wait to be written.
   * @returns the count
   */
  get pendingCount(): number {
    return this.#pending.length;
  }
}
