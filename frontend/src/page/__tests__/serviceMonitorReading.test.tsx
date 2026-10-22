// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  advance,
  byText,
  click,
  mount,
  textsOf,
  unmountAll,
} from '../../__tests__/dom.ts';
import {
  BASE_PATH,
  NOW,
  STATUS,
  fakeMonitor,
  heldAnswer,
  logLine,
  logsPage,
  refusal,
} from '../../__tests__/fixtures.ts';
import { ServiceMonitor } from '../ServiceMonitor.tsx';
import type { MonitorSection } from '../sections.ts';

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
 * A monitor whose status answers come in the order given, the last one
 * repeated, and whose logs hold one line.
 * @param statuses - what each reading of the status answers
 * @returns the fetch, and what it was asked
 */
function monitorOf(...statuses: unknown[]) {
  let read = 0;
  return fakeMonitor((route) => {
    if (route === '/status') {
      read++;
      return statuses[Math.min(read, statuses.length) - 1];
    }
    if (route === '/logs/facets') return { topics: [], roles: [] };
    return logsPage([logLine(42)]);
  });
}

/**
 * The sentence above the sections.
 * @param host - the monitor
 * @returns what it says
 */
function noteOf(host: HTMLElement): string | undefined {
  return host.querySelector('.monitor-page > .monitor-note')?.textContent;
}

test('once the status answers, the overview shows the health checks and the machine', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );

  expect(noteOf(host)).toBe('Reading…');

  await advance();

  expect(noteOf(host)).toBe('Read just now from web-1; read again every 10 s.');
  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
  expect(textsOf(host, '.monitor-check')).toStrictEqual([
    '12% of the data volume is free: make room before it fills.',
    'Every process reports.',
  ]);
  expect(textsOf(host, '.monitor-meter dt')).toStrictEqual([
    'Processor, whole machine 22 %',
    'Memory, whole machine 63 %',
    'Data volume 88 %',
  ]);
  expect(asked).toStrictEqual(['/v1/monitor/status']);
});

test('the status is read again ten seconds after each answer, and not while the tab is hidden', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  mount(<ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />);
  await advance();

  await advance(9999);

  expect(asked).toHaveLength(1);

  await advance(1);

  expect(asked).toHaveLength(2);

  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  await advance(20_000);

  expect(asked).toHaveLength(2);

  visibility.mockReturnValue('visible');
  await advance(10_000);

  expect(asked).toHaveLength(3);
});

test('a monitor opened in a hidden tab reads the status once, then waits for the tab to show', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { fetcher, asked } = monitorOf(STATUS);
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();
  await advance(30_000);

  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
  expect(asked).toStrictEqual(['/v1/monitor/status']);
});

test('the host page chooses how long after an answer the status is read again', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  const { host } = mount(
    <ServiceMonitor
      apiBasePath={BASE_PATH}
      fetcher={fetcher}
      refreshMs={30_000}
    />,
  );
  await advance();
  await advance(29_999);

  expect(noteOf(host)).toBe('Read just now from web-1; read again every 30 s.');
  expect(asked).toHaveLength(1);

  await advance(1);

  expect(asked).toHaveLength(2);
});

test('the Refresh button reads the status at once, and the next reading waits ten seconds from it', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance(6000);

  click(byText(host, 'button', 'Refresh'));
  await advance();

  expect(asked).toHaveLength(2);

  await advance(9999);

  expect(asked).toHaveLength(2);

  await advance(1);

  expect(asked).toHaveLength(3);
});

test('a status that cannot be read is said, and the one read before stays on show until the next answers', async () => {
  const { fetcher } = monitorOf(
    STATUS,
    refusal(503, 'The store is locked'),
    STATUS,
  );
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();
  await advance(10_000);

  expect(textsOf(host, '.bp6-callout')).toStrictEqual([
    'The status could not be read/v1/monitor/status answered 503: The store is locked',
  ]);
  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);

  await advance(10_000);

  expect(host.querySelectorAll('.bp6-callout')).toHaveLength(0);
  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
});

test('a first status that cannot be read is said in place of the spinner', async () => {
  const { fetcher } = monitorOf(refusal(401, 'Sign in first'));
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();

  expect(noteOf(host)).toBe('Reading…');
  expect(textsOf(host, '.bp6-callout')).toStrictEqual([
    'The status could not be read/v1/monitor/status answered 401: Sign in first',
  ]);
  expect(host.querySelectorAll('.bp6-spinner')).toHaveLength(0);
});

test('the Processes tab shows every process from the reading already made', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  const sections: MonitorSection[] = [];
  const { host } = mount(
    <ServiceMonitor
      apiBasePath={BASE_PATH}
      fetcher={fetcher}
      onSectionChange={(section) => {
        sections.push(section);
      }}
    />,
  );
  await advance();

  click(byText(host, '[role="tab"]', 'Processes'));
  await advance();

  expect(sections).toStrictEqual(['processes']);
  expect(textsOf(host, 'h2')).toStrictEqual(['Processes']);
  expect(textsOf(host, 'tbody strong')).toStrictEqual(['server', 'import']);
  expect(asked).toStrictEqual(['/v1/monitor/status']);
});

test('the Logs tab stops reading the status and reads the lines, and the overview reads it again at once', async () => {
  const { fetcher, asked } = monitorOf(STATUS);
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();

  click(byText(host, '[role="tab"]', 'Logs'));
  await advance();
  await advance(10_000);

  expect(textsOf(host, 'h2')).toStrictEqual(['Logs']);
  expect(host.querySelectorAll('.monitor-page__bar > button')).toHaveLength(0);
  expect(noteOf(host)).toBeUndefined();
  expect(textsOf(host, '.monitor-log__text')).toStrictEqual(['request 42']);
  expect(asked).toStrictEqual([
    '/v1/monitor/status',
    '/v1/monitor/logs?minLevel=info&limit=200',
    '/v1/monitor/logs/facets',
    '/v1/monitor/logs?minLevel=info&after=42&limit=200',
    '/v1/monitor/logs?minLevel=info&after=42&limit=200',
  ]);

  click(byText(host, '[role="tab"]', 'Overview'));
  await advance();

  expect(asked.at(-1)).toBe('/v1/monitor/status');
  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
});

test('a page that keeps the section in its address is told which tab was asked for, and shows the one it gives', async () => {
  const { fetcher } = monitorOf(STATUS);
  const sections: MonitorSection[] = [];
  const onSectionChange = (section: MonitorSection) => {
    sections.push(section);
  };
  const { host, render } = mount(
    <ServiceMonitor
      apiBasePath={BASE_PATH}
      fetcher={fetcher}
      section="processes"
      onSectionChange={onSectionChange}
    />,
  );
  await advance();

  click(byText(host, '[role="tab"]', 'Overview'));

  expect(sections).toStrictEqual(['overview']);
  expect(textsOf(host, 'h2')).toStrictEqual(['Processes']);

  render(
    <ServiceMonitor
      apiBasePath={BASE_PATH}
      fetcher={fetcher}
      section="overview"
      onSectionChange={onSectionChange}
    />,
  );

  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
});

test('nothing more is read, and an answer still on its way is dropped, once the monitor is gone', async () => {
  const held = heldAnswer();
  const { fetcher, asked } = fakeMonitor(() => held.promise);
  const { unmount } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );

  unmount();
  held.release(STATUS);
  await advance(30_000);

  expect(asked).toStrictEqual(['/v1/monitor/status']);
});

test('a status stopped for a reason that is not an error says that reason', async () => {
  const { fetcher } = fakeMonitor(() => {
    AbortSignal.abort('The session ended').throwIfAborted();
  });
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );
  await advance();

  expect(textsOf(host, '.bp6-callout')).toStrictEqual([
    'The status could not be readThe session ended',
  ]);
});

test('a reading that fails once Refresh asked again is not said', async () => {
  const held = heldAnswer();
  const { fetcher, asked } = monitorOf(held.promise, STATUS);
  const { host } = mount(
    <ServiceMonitor apiBasePath={BASE_PATH} fetcher={fetcher} />,
  );

  click(byText(host, 'button', 'Refresh'));
  await advance();
  held.release(refusal(503, 'The store is locked'));
  await advance();

  expect(asked).toStrictEqual(['/v1/monitor/status', '/v1/monitor/status']);
  expect(host.querySelectorAll('.bp6-callout')).toHaveLength(0);
  expect(textsOf(host, 'h2')).toStrictEqual(['Health', 'Machine']);
});
