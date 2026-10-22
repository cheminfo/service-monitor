// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  advance,
  byText,
  click,
  mount,
  textsOf,
  typeInto,
  unmountAll,
} from '../../__tests__/dom.ts';
import {
  BASE_PATH,
  NOW,
  fakeMonitor,
  heldAnswer,
  logLine,
  logsPage,
  refusal,
} from '../../__tests__/fixtures.ts';
import type { LogFacetsResponse, LogsResponse } from '../../types.ts';
import type { LogsViewerProps } from '../LogsViewer.tsx';
import { LogsViewer } from '../LogsViewer.tsx';

const REQUEST = logLine(42, { message: 'GET /v1/molecules answered 200' });
const SLOW_QUERY = logLine(41, {
  at: NOW - 9000,
  level: 40,
  levelLabel: 'warn',
  topic: 'db',
  role: 'import',
  message: 'A query took 1.2 s',
  meta: { sql: 'SELECT 1', durationMs: 1200 },
});

const FACETS: LogFacetsResponse = {
  topics: [
    { name: 'http', lastAt: NOW },
    { name: 'db', lastAt: NOW },
  ],
  roles: [
    { name: 'server', lastAt: NOW },
    { name: 'import', lastAt: NOW },
  ],
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A viewer reading from a monitor that answers each query of `GET /logs`
 * from the pages given, and the topics from the facets given.
 * @param pages - what each query answers, by its query string
 * @param facets - what the facets route answers
 * @param props - the other props of the viewer
 * @returns the viewer, and what it asked
 */
function viewerOf(
  pages: Record<string, LogsResponse | Response>,
  facets: LogFacetsResponse | Response = FACETS,
  props: Partial<LogsViewerProps> = {},
) {
  const monitor = fakeMonitor((route, query) => {
    if (route === '/logs/facets') return facets;
    return pages[query.toString()] ?? logsPage([]);
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={monitor.fetcher} {...props} />,
  );
  return { host, asked: monitor.asked };
}

/**
 * The lines on show, each as the parts a reader sees.
 * @param host - the viewer
 * @returns when, the level, the topic, the process and the message of each
 */
function linesOf(host: HTMLElement): string[][] {
  const lines: string[][] = [];
  for (const line of host.querySelectorAll('.monitor-log__line')) {
    lines.push(
      textsOf(
        line,
        'time, .monitor-log__level, .monitor-log__topic, .monitor-log__role, .monitor-log__text',
      ),
    );
  }
  return lines;
}

/**
 * A capsule of a row of the filter bar.
 * @param host - the viewer
 * @param row - the row's label
 * @param text - what the capsule reads
 * @returns the capsule
 */
function capsule(host: HTMLElement, row: string, text: string): Element {
  const group = host.querySelector(
    `[role="group"][aria-label="${CSS.escape(row)}"]`,
  );
  if (group === null) throw new Error(`no row of ${row}`);
  return byText(group, '[role="button"]', text);
}

test('the viewer spins, then shows the newest lines from the info level up', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY]),
  });

  expect(host.querySelectorAll('.bp6-spinner')).toHaveLength(1);
  expect(asked).toStrictEqual([
    '/v1/monitor/logs?minLevel=info&limit=200',
    '/v1/monitor/logs/facets',
  ]);

  await advance();

  expect(host.querySelectorAll('.bp6-spinner')).toHaveLength(0);
  expect(linesOf(host)).toStrictEqual([
    ['14:03:05', 'info', 'http', 'server', 'GET /v1/molecules answered 200'],
    ['14:02:58', 'warn', 'db', 'import', 'A query took 1.2 s'],
  ]);
});

test('a click unfolds the other fields of a line, and another folds them back', async () => {
  const { host } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY]),
  });
  await advance();
  const head = host.querySelector('.monitor-log__head--more');

  click(head);

  expect(head?.getAttribute('aria-expanded')).toBe('true');
  expect(textsOf(host, 'pre')).toStrictEqual([
    '{\n  "sql": "SELECT 1",\n  "durationMs": 1200\n}',
  ]);

  click(head);

  expect(head?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelectorAll('pre')).toHaveLength(0);
});

test('picking a level reads the lines again from it, the old ones greyed until they come', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY]),
    'minLevel=warn&limit=200': logsPage([SLOW_QUERY]),
  });
  await advance();

  click(capsule(host, 'From level', 'warn'));

  expect(asked.at(-1)).toBe('/v1/monitor/logs?minLevel=warn&limit=200');
  expect(host.querySelectorAll('.monitor-logs__stale')).toHaveLength(1);
  expect(linesOf(host)).toHaveLength(2);

  await advance();

  expect(host.querySelectorAll('.monitor-logs__stale')).toHaveLength(0);
  expect(linesOf(host)).toStrictEqual([
    ['14:02:58', 'warn', 'db', 'import', 'A query took 1.2 s'],
  ]);
});

test('the text is searched once typing has paused for 300 ms', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY]),
    'minLevel=info&q=query&limit=200': logsPage([SLOW_QUERY]),
  });
  await advance();

  typeInto(host.querySelector('input[type="search"]'), 'query');
  await advance(299);

  expect(asked).toHaveLength(2);

  await advance(1);

  expect(asked.at(-1)).toBe('/v1/monitor/logs?minLevel=info&q=query&limit=200');
  expect(linesOf(host).map((line) => line[4])).toStrictEqual([
    'A query took 1.2 s',
  ]);
});

test('picking a topic and then a process narrows the lines to both', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY]),
  });
  await advance();

  click(capsule(host, 'Topics', 'db'));
  await advance();
  click(capsule(host, 'Processes', 'import'));
  await advance();

  expect(asked.slice(2)).toStrictEqual([
    '/v1/monitor/logs?minLevel=info&topic=db&limit=200',
    '/v1/monitor/logs?minLevel=info&topic=db&role=import&limit=200',
  ]);
});

test('a search that stopped at the most recent lines says so', async () => {
  const { host } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST], { truncated: true }),
  });
  await advance();

  expect(textsOf(host, '.monitor-note')).toStrictEqual([
    'The search read the most recent lines only.',
  ]);
});

test('lines that cannot be read are said alone, and read again at the live pace until they come', async () => {
  let isDown = true;
  const monitor = fakeMonitor((route) => {
    if (route === '/logs/facets') return FACETS;
    return isDown ? refusal(500, 'The store is closed') : logsPage([REQUEST]);
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={monitor.fetcher} />,
  );
  await advance();

  expect(textsOf(host, '.bp6-callout .bp6-heading')).toStrictEqual([
    'The lines could not be read',
  ]);
  expect(host.querySelector('.bp6-callout')?.textContent).toBe(
    'The lines could not be read/v1/monitor/logs?minLevel=info&limit=200 answered 500: The store is closed',
  );
  // Nothing could be read, which is not the same as nothing matching.
  expect(textsOf(host, '.monitor-note')).toStrictEqual([]);

  await advance(5000);

  expect(monitor.asked).toStrictEqual([
    '/v1/monitor/logs?minLevel=info&limit=200',
    '/v1/monitor/logs/facets',
    '/v1/monitor/logs?minLevel=info&limit=200',
  ]);
  expect(textsOf(host, '.bp6-callout .bp6-heading')).toStrictEqual([
    'The lines could not be read',
  ]);

  isDown = false;
  await advance(5000);

  expect(monitor.asked).toHaveLength(4);
  expect(host.querySelectorAll('.bp6-callout')).toHaveLength(0);
  expect(linesOf(host)).toHaveLength(1);
});

test('a server slower than the pace is asked again only once it answered', async () => {
  const held = heldAnswer();
  let reads = 0;
  const monitor = fakeMonitor((route) => {
    if (route === '/logs/facets') return FACETS;
    reads += 1;
    if (reads === 1) return refusal(503, 'Deploying');
    if (reads === 2) return held.promise;
    return logsPage([REQUEST]);
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={monitor.fetcher} />,
  );
  await advance();

  await advance(5000);
  await advance(30_000);
  const whileHeld = reads;
  held.release(refusal(503, 'Still deploying'));
  await advance();
  const said = host.querySelector('.bp6-callout')?.textContent;
  await advance(5000);

  expect(whileHeld).toBe(2);
  expect(said).toBe(
    'The lines could not be read/v1/monitor/logs?minLevel=info&limit=200 answered 503: Still deploying',
  );
  expect(reads).toBe(3);
  expect(linesOf(host)).toHaveLength(1);
});

test('with live off, lines that cannot be read wait for the button', async () => {
  let isDown = true;
  const monitor = fakeMonitor((route) => {
    if (route === '/logs/facets') return FACETS;
    return isDown ? refusal(500, 'The store is closed') : logsPage([REQUEST]);
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={monitor.fetcher} />,
  );
  await advance();

  click(host.querySelector('.monitor-filter-bar__live input'));
  await advance(20_000);

  expect(monitor.asked).toHaveLength(2);

  isDown = false;
  click(host.querySelector('[aria-label="Read again"]'));
  await advance();

  expect(monitor.asked.slice(2)).toStrictEqual([
    '/v1/monitor/logs?minLevel=info&limit=200',
    '/v1/monitor/logs/facets',
  ]);
  expect(host.querySelectorAll('.bp6-callout')).toHaveLength(0);
  expect(linesOf(host)).toHaveLength(1);
});

test('older lines are read on demand, from the oldest one on show', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY], {
      nextBefore: 41,
    }),
    'minLevel=info&before=41&limit=200': logsPage([
      logLine(40, { at: NOW - 60_000 }),
      logLine(39, { at: NOW - 61_000 }),
    ]),
  });
  await advance();
  const older = byText(host, 'button', 'Older lines');

  click(older);
  await advance();

  expect(asked.at(-1)).toBe(
    '/v1/monitor/logs?minLevel=info&before=41&limit=200',
  );
  expect(linesOf(host).map((line) => line[0])).toStrictEqual([
    '14:03:05',
    '14:02:58',
    '14:02:07',
    '14:02:06',
  ]);
  expect(host.querySelectorAll('.monitor-logs__older')).toHaveLength(0);
});

test('an older page that cannot be read is said above the lines kept on show', async () => {
  const { host } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST, SLOW_QUERY], {
      nextBefore: 41,
    }),
    'minLevel=info&before=41&limit=200': refusal(503, 'Try again'),
  });
  await advance();

  click(byText(host, 'button', 'Older lines'));
  await advance();

  expect(host.querySelector('.bp6-callout')?.textContent).toBe(
    'The lines could not be read/v1/monitor/logs?minLevel=info&before=41&limit=200 answered 503: Try again',
  );
  expect(linesOf(host)).toHaveLength(2);
  expect(textsOf(host, '.monitor-logs__older')).toStrictEqual(['Older lines']);
});

test('an older page that failed is read again on demand, and the lines written since keep coming meanwhile', async () => {
  let olderReads = 0;
  const monitor = fakeMonitor((_route, query) => {
    const search = query.toString();
    if (search === 'minLevel=info&limit=200') {
      return logsPage([REQUEST, SLOW_QUERY], { nextBefore: 41 });
    }
    if (search === 'minLevel=info&before=41&limit=200') {
      olderReads += 1;
      return olderReads === 1
        ? refusal(503, 'Try again')
        : logsPage([logLine(40, { at: NOW - 60_000 })]);
    }
    if (search === 'minLevel=info&after=42&limit=200') {
      return logsPage([logLine(43, { at: NOW + 4000, message: 'later' })]);
    }
    if (search === '') return FACETS;
    return logsPage([]);
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={monitor.fetcher} />,
  );
  await advance();

  click(byText(host, 'button', 'Older lines'));
  await advance();
  const failed = textsOf(host, '.bp6-callout .bp6-heading');
  await advance(5000);
  const whileFailed = linesOf(host).length;

  click(byText(host, 'button', 'Older lines'));
  await advance();

  expect(failed).toStrictEqual(['The lines could not be read']);
  expect(whileFailed).toBe(3);
  expect(host.querySelectorAll('.bp6-callout')).toHaveLength(0);
  expect(linesOf(host)).toHaveLength(4);
});

test('while live, the lines written since are read every five seconds and put in front', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST]),
    'minLevel=info&after=42&limit=200': logsPage([
      logLine(43, { at: NOW + 1000 }),
      logLine(44, { at: NOW + 2000 }),
    ]),
  });
  await advance();

  await advance(4999);

  expect(asked).toHaveLength(2);

  await advance(1);

  expect(asked.at(-1)).toBe(
    '/v1/monitor/logs?minLevel=info&after=42&limit=200',
  );
  expect(linesOf(host).map((line) => line[4])).toStrictEqual([
    'request 44',
    'request 43',
    'GET /v1/molecules answered 200',
  ]);

  await advance(5000);

  expect(asked.at(-1)).toBe(
    '/v1/monitor/logs?minLevel=info&after=44&limit=200',
  );
});

test('turning live off stops reading the lines written since', async () => {
  const { host, asked } = viewerOf({
    'minLevel=info&limit=200': logsPage([REQUEST]),
  });
  await advance();
  const live = host.querySelector<HTMLInputElement>(
    '.monitor-filter-bar__live input',
  );

  click(live);
  await advance(20_000);

  expect(live?.checked).toBe(false);
  expect(asked).toStrictEqual([
    '/v1/monitor/logs?minLevel=info&limit=200',
    '/v1/monitor/logs/facets',
  ]);
});

test('topics that cannot be read leave the level and the text to filter by', async () => {
  const { host } = viewerOf(
    { 'minLevel=info&limit=200': logsPage([REQUEST]) },
    refusal(500, 'No facets'),
  );
  await advance();

  expect(
    Array.from(host.querySelectorAll('[role="group"]'), (group) =>
      group.getAttribute('aria-label'),
    ),
  ).toStrictEqual(['From level']);
  expect(linesOf(host)).toHaveLength(1);
});

test('the host page chooses the first level, the size of a page and the pace', async () => {
  const { asked } = viewerOf({ 'limit=50': logsPage([REQUEST]) }, FACETS, {
    initialMinLevel: 'trace',
    pageSize: 50,
    refreshMs: 1000,
  });
  await advance();
  await advance(1000);

  expect(asked).toStrictEqual([
    '/v1/monitor/logs?limit=50',
    '/v1/monitor/logs/facets',
    '/v1/monitor/logs?after=42&limit=50',
  ]);
});

test('a fetch stopped for a reason that is not an error says that reason', async () => {
  const { fetcher } = fakeMonitor((route) => {
    // A fetch aborted with a reason rejects with that reason, here a string.
    if (route === '/logs') {
      AbortSignal.abort('The session ended').throwIfAborted();
    }
    return FACETS;
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();

  expect(host.querySelector('.bp6-callout')?.textContent).toBe(
    'The lines could not be readThe session ended',
  );
});

test('topics that come once everything was read again are dropped', async () => {
  const held = heldAnswer();
  let facetsRead = 0;
  const { fetcher } = fakeMonitor((route) => {
    if (route !== '/logs/facets') return logsPage([REQUEST]);
    facetsRead++;
    return facetsRead === 1 ? held.promise : FACETS;
  });
  const { host } = mount(
    <LogsViewer apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();

  click(host.querySelector('[aria-label="Read again"]'));
  await advance();
  held.release({
    topics: [...FACETS.topics, { name: 'mail', lastAt: NOW }],
    roles: FACETS.roles,
  });
  await advance();

  expect(
    textsOf(host, '[role="group"][aria-label="Topics"] [role="button"]'),
  ).toStrictEqual(['every topic', 'http', 'db']);
});
