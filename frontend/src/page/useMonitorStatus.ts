import { useCallback, useEffect, useState } from 'react';

import type { MonitorClient } from '../apiClient.ts';
import type { MonitorStatus } from '../types.ts';

/**
 * What the status reading has come to.
 */
export interface MonitorStatusReading {
  /**
   * The latest status read, kept while a later reading fails.
   */
  status: MonitorStatus | undefined;
  /**
   * Why the latest reading failed, or undefined when it answered.
   */
  error: string | undefined;
  /**
   * Read the status again now.
   */
  reload: () => void;
}

/**
 * Read the status now, then again a while after each answer, one request at
 * a time and nothing while the tab is hidden; the status read last stays on
 * show while the next is read, and while one fails.
 * @param client - the monitor's client, stable across renders
 * @param options - whether to read, and how often
 * @param options.enabled - whether the status is read at all
 * @param options.refreshMs - how long after an answer the next is asked
 * @returns the reading
 */
export function useMonitorStatus(
  client: MonitorClient,
  options: { enabled: boolean; refreshMs: number },
): MonitorStatusReading {
  const { enabled, refreshMs } = options;
  const [reading, setReading] = useState<{
    status: MonitorStatus | undefined;
    error: string | undefined;
  }>({ status: undefined, error: undefined });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (isFirst: boolean) => {
      if (isFirst || document.visibilityState !== 'hidden') {
        try {
          const status = await client.status();
          if (isCurrent) setReading({ status, error: undefined });
        } catch (error: unknown) {
          if (isCurrent) {
            setReading((previous) => ({
              status: previous.status,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      }
      if (isCurrent) timer = setTimeout(() => void read(false), refreshMs);
    };
    void read(true);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [client, enabled, refreshMs, reloads]);

  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { ...reading, reload };
}
