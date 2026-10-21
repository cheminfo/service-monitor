import { useEffect, useState } from 'react';

import type { LogFilters, MonitorClient } from '../apiClient.ts';
import { logsSearch } from '../apiClient.ts';
import type { LogEntry, LogFacetsResponse } from '../types.ts';

import { withNewer } from './logLines.ts';

/**
 * The lines kept on show while live; past it the oldest go.
 */
const MAX_LINES = 5000;

/**
 * The lines read for one set of filters.
 */
export interface Reading {
  /**
   * The filters it was read with, so a stale answer is told apart.
   */
  key: string;
  /**
   * The newest first.
   */
  lines: LogEntry[];
  nextBefore: number | null;
  truncated: boolean;
  error: string | null;
  /**
   * When the lines were last read, in unix milliseconds.
   */
  readAt: number;
}

/**
 * How the lines are read.
 */
export interface LogReadingOptions {
  pageSize: number;
  refreshMs: number;
  /**
   * Whether the lines written since are read as they come.
   */
  isLive: boolean;
}

/**
 * The lines for a set of filters, read again whenever they change, and the
 * lines written since read every few seconds while live and the page is on
 * show.
 * @param client - the monitor's routes
 * @param filters - which lines
 * @param options - the page size, the pace and whether it is live
 * @returns the reading, whether it matches the filters yet, and the means to
 *   read older lines or everything again
 */
export function useLogReading(
  client: MonitorClient,
  filters: LogFilters,
  options: LogReadingOptions,
) {
  const { pageSize, refreshMs, isLive } = options;
  const [reloads, setReloads] = useState(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const [facets, setFacets] = useState<LogFacetsResponse | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const key = `${logsSearch(filters)}#${reloads}`;
  const current = reading?.key === key ? reading : null;
  const newestId = current?.lines[0]?.id ?? 0;
  const isReadable = current !== null && current.error === null;

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      let next: Reading;
      try {
        const page = await client.logs(filters, { limit: pageSize });
        next = {
          key,
          lines: page.logs,
          nextBefore: page.nextBefore,
          truncated: page.truncated,
          error: null,
          readAt: Date.now(),
        };
      } catch (error: unknown) {
        next = {
          key,
          lines: [],
          nextBefore: null,
          truncated: false,
          error: messageOf(error),
          readAt: Date.now(),
        };
      }
      if (!isCancelled) setReading(next);
    })();
    return () => {
      isCancelled = true;
    };
  }, [client, filters, key, pageSize]);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      try {
        const answer = await client.facets();
        if (!isCancelled) setFacets(answer);
      } catch {
        // The filters offer the level and the text alone.
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [client, reloads]);

  useEffect(() => {
    if (!isLive || !isReadable) return;
    const readNewer = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const page = await client.logs(filters, {
          after: newestId,
          limit: pageSize,
        });
        // More came than a page holds: read the newest page again.
        if (page.logs.length >= pageSize) {
          setReloads((count) => count + 1);
          return;
        }
        setReading((previous) =>
          previous?.key === key
            ? withNewerLines(previous, page.logs)
            : previous,
        );
      } catch {
        // The next tick tries again.
      }
    };
    const timer = setInterval(() => void readNewer(), refreshMs);
    return () => clearInterval(timer);
  }, [isLive, isReadable, client, filters, key, newestId, pageSize, refreshMs]);

  /**
   * Read the page older than the oldest line on show.
   */
  async function loadOlder() {
    const before = current?.nextBefore;
    if (before === null || before === undefined) return;
    setIsLoadingOlder(true);
    try {
      const page = await client.logs(filters, { before, limit: pageSize });
      setReading((previous) =>
        previous?.key === key
          ? {
              ...previous,
              lines: previous.lines.concat(page.logs),
              nextBefore: page.nextBefore,
            }
          : previous,
      );
    } catch (error: unknown) {
      setReading((previous) =>
        previous?.key === key
          ? { ...previous, error: messageOf(error) }
          : previous,
      );
    } finally {
      setIsLoadingOlder(false);
    }
  }

  return {
    /**
     * What is on show: the reading of these filters, or the last one while
     * these are read.
     */
    reading: current ?? reading,
    /**
     * Whether what is on show matches the filters.
     */
    isCurrent: current !== null,
    facets,
    isLoadingOlder,
    loadOlder,
    reload: () => setReloads((count) => count + 1),
  };
}

/**
 * A reading with the lines written since in front, keeping the most recent
 * lines only past the most kept on show.
 * @param reading - the reading
 * @param newer - the lines written since, the oldest first
 * @returns the reading, updated
 */
function withNewerLines(reading: Reading, newer: readonly LogEntry[]): Reading {
  const readAt = Date.now();
  const lines = withNewer(reading.lines, newer);
  if (lines.length <= MAX_LINES) return { ...reading, lines, readAt };
  const kept = lines.slice(0, MAX_LINES);
  return {
    ...reading,
    lines: kept,
    nextBefore: kept.at(-1)?.id ?? null,
    readAt,
  };
}

/**
 * What an error says.
 * @param error - what was thrown
 * @returns its message
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
