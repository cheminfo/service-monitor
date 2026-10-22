// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { advance, click, mount, unmountAll } from '../../__tests__/dom.ts';
import {
  BASE_PATH,
  NOW,
  fakeMonitor,
  heldAnswer,
  logLine,
  logsPage,
  refusal,
} from '../../__tests__/fixtures.ts';
import type { LogFilters, MonitorClient } from '../../apiClient.ts';
import { createMonitorClient } from '../../apiClient.ts';
import type { LogEntry } from '../../types.ts';
import { useLogReading } from '../useLogReading.ts';

const EVERY_LINE: LogFilters = {
  minLevel: 'trace',
  topics: [],
  roles: [],
  text: '',
};
const ERRORS: LogFilters = { ...EVERY_LINE, minLevel: 'error' };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * What the hook reads, written out where a test can read it back, and a
 * button asking for older lines.
 * @param props - The reading.
 * @param props.client - The monitor's routes.
 * @param props.filters - Which lines.
 * @param props.pageSize - The lines a page holds.
 * @returns The probe.
 */
function Probe(props: {
  client: MonitorClient;
  filters: LogFilters;
  pageSize: number;
}) {
  const { client, filters, pageSize } = props;
  const { reading, isCurrent, loadOlder } = useLogReading(client, filters, {
    pageSize,
    refreshMs: 5000,
    isLive: true,
  });
  const lines = reading?.lines ?? [];
  return (
    <>
      <output>
        {JSON.stringify({
          isCurrent,
          count: lines.length,
          newest: lines[0]?.id ?? null,
          oldest: lines.at(-1)?.id ?? null,
          nextBefore: reading?.nextBefore ?? null,
          error: reading?.error ?? null,
        })}
      </output>
      <button type="button" onClick={() => void loadOlder()}>
        Older
      </button>
    </>
  );
}

/**
 * The hook, reading from a monitor that answers as given.
 * @param answer - what a route answers to a query
 * @param pageSize - the lines a page holds
 * @returns the probe, its client and what was asked
 */
function probeOf(
  answer: (route: string, query: URLSearchParams) => unknown,
  pageSize = 200,
) {
  const monitor = fakeMonitor(answer);
  const client = createMonitorClient(BASE_PATH, monitor.fetcher);
  const mounted = mount(
    <Probe client={client} filters={EVERY_LINE} pageSize={pageSize} />,
  );
  return { ...mounted, client, asked: monitor.asked };
}

/**
 * What the probe last wrote.
 * @param host - the probe
 * @returns the reading, summed up
 */
function readingOf(host: HTMLElement): unknown {
  return JSON.parse(host.querySelector('output')?.textContent ?? 'null');
}

/**
 * Lines with consecutive ids.
 * @param newest - the id of the newest
 * @param oldest - the id of the oldest
 * @returns the lines, the newest first
 */
function linesFrom(newest: number, oldest: number): LogEntry[] {
  const lines: LogEntry[] = [];
  for (let id = newest; id >= oldest; id--) lines.push(logLine(id));
  return lines;
}

test('more lines written since than a page holds read the newest page again, the topics too', async () => {
  let pagesRead = 0;
  const { host, asked } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (query.has('after')) return logsPage(linesFrom(15, 13).toReversed());
    pagesRead++;
    return logsPage(pagesRead === 1 ? linesFrom(12, 10) : linesFrom(15, 13));
  }, 3);
  await advance();
  await advance(5000);
  await advance();

  expect(asked).toStrictEqual([
    '/v1/monitor/logs?limit=3',
    '/v1/monitor/logs/facets',
    '/v1/monitor/logs?after=12&limit=3',
    '/v1/monitor/logs?limit=3',
    '/v1/monitor/logs/facets',
  ]);
  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 3,
    newest: 15,
    oldest: 13,
    nextBefore: null,
    error: null,
  });
});

test('nothing written since is read while the page is hidden', async () => {
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  const { asked } = probeOf((route) =>
    route === '/logs/facets'
      ? { topics: [], roles: [] }
      : logsPage([logLine(42)]),
  );
  await advance();
  await advance(10_000);

  expect(asked).toHaveLength(2);

  visibility.mockReturnValue('visible');
  await advance(5000);

  expect(asked.slice(2)).toStrictEqual(['/v1/monitor/logs?after=42&limit=200']);
});

test('past 5000 lines the oldest go, and the next older page starts after the oldest kept', async () => {
  const { host, asked } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (query.has('after')) return logsPage(linesFrom(5003, 5001).toReversed());
    if (query.has('before')) return logsPage(linesFrom(3, 1));
    return logsPage(linesFrom(5000, 2), { nextBefore: 2 });
  });
  await advance();
  await advance(5000);

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 5000,
    newest: 5003,
    oldest: 4,
    nextBefore: 4,
    error: null,
  });

  click(host.querySelector('button'));
  await advance();

  expect(asked.at(-1)).toBe('/v1/monitor/logs?before=4&limit=200');
});

test('a read of the lines written since that fails is tried again at the next tick, unsaid', async () => {
  let newerRead = 0;
  const { host } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (!query.has('after')) return logsPage([logLine(42)]);
    newerRead++;
    return newerRead === 1 ? refusal(503, 'Busy') : logsPage([logLine(43)]);
  });
  await advance();
  await advance(5000);

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 1,
    newest: 42,
    oldest: 42,
    nextBefore: null,
    error: null,
  });

  await advance(5000);

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 2,
    newest: 43,
    oldest: 42,
    nextBefore: null,
    error: null,
  });
});

test('an answer to filters no longer asked for is dropped', async () => {
  const held = heldAnswer();
  const { host, client, render } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    return query.get('minLevel') === 'error'
      ? logsPage([logLine(9, { level: 50, levelLabel: 'error' })])
      : held.promise;
  });

  render(<Probe client={client} filters={ERRORS} pageSize={200} />);
  await advance();
  held.release(logsPage(linesFrom(42, 40)));
  await advance();

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 1,
    newest: 9,
    oldest: 9,
    nextBefore: null,
    error: null,
  });
});

test('an older page that comes once the filters changed is dropped', async () => {
  const held = heldAnswer();
  const { host, client, render } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (query.has('before')) return held.promise;
    return query.get('minLevel') === 'error'
      ? logsPage([logLine(9, { level: 50, levelLabel: 'error' })])
      : logsPage(linesFrom(42, 41), { nextBefore: 41 });
  });
  await advance();

  click(host.querySelector('button'));
  render(<Probe client={client} filters={ERRORS} pageSize={200} />);
  await advance();
  held.release(logsPage(linesFrom(40, 39)));
  await advance();

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 1,
    newest: 9,
    oldest: 9,
    nextBefore: null,
    error: null,
  });
});

test('older lines are not asked for when there are none', async () => {
  const { host, asked } = probeOf((route) =>
    route === '/logs/facets'
      ? { topics: [], roles: [] }
      : logsPage([logLine(42)]),
  );
  await advance();

  click(host.querySelector('button'));
  await advance();

  expect(asked).toStrictEqual([
    '/v1/monitor/logs?limit=200',
    '/v1/monitor/logs/facets',
  ]);
});

test('lines written since that come once the filters changed are dropped', async () => {
  const held = heldAnswer();
  const { host, client, render } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (query.has('after')) return held.promise;
    return query.get('minLevel') === 'error'
      ? logsPage([logLine(9, { level: 50, levelLabel: 'error' })])
      : logsPage([logLine(42)]);
  });
  await advance();
  await advance(5000);

  render(<Probe client={client} filters={ERRORS} pageSize={200} />);
  await advance();
  held.release(logsPage([logLine(43)]));
  await advance();

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 1,
    newest: 9,
    oldest: 9,
    nextBefore: null,
    error: null,
  });
});

test('an older page that fails once the filters changed is not said', async () => {
  const held = heldAnswer();
  const { host, client, render } = probeOf((route, query) => {
    if (route === '/logs/facets') return { topics: [], roles: [] };
    if (query.has('before')) return held.promise;
    return query.get('minLevel') === 'error'
      ? logsPage([logLine(9, { level: 50, levelLabel: 'error' })])
      : logsPage(linesFrom(42, 41), { nextBefore: 41 });
  });
  await advance();

  click(host.querySelector('button'));
  render(<Probe client={client} filters={ERRORS} pageSize={200} />);
  await advance();
  held.release(refusal(503, 'Busy'));
  await advance();

  expect(readingOf(host)).toStrictEqual({
    isCurrent: true,
    count: 1,
    newest: 9,
    oldest: 9,
    nextBefore: null,
    error: null,
  });
});
