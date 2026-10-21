import { onTestFinished } from 'vitest';

import { MonitorStore } from '../store/MonitorStore.ts';
import type { LogRow } from '../store/statements.ts';

/**
 * A store in memory, closed when the calling test finishes.
 * @param maxScanLines - the most recent lines a text search reads
 * @returns the store
 */
export async function openStore(maxScanLines?: number): Promise<MonitorStore> {
  const store = await MonitorStore.open(':memory:', { maxScanLines });
  onTestFinished(() => store.close());
  return store;
}

/**
 * A line as the store keeps it.
 * @param row - what differs from an info line of the server
 * @returns the line
 */
export function logRow(row: Partial<LogRow> = {}): LogRow {
  return {
    at: 1_790_000_000_000,
    level: 30,
    topic: 'main',
    role: 'server',
    pid: 7,
    hostname: 'host',
    message: 'a line',
    meta: null,
    ...row,
  };
}
