import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { NOW } from '../../__tests__/fixtures.ts';
import type { LogFacetsResponse } from '../../types.ts';
import type { LogFilterBarProps } from '../LogFilterBar.tsx';
import { LogFilterBar } from '../LogFilterBar.tsx';

const CAPSULE =
  /<span aria-pressed="(?<pressed>true|false)" tabindex="0" class="bp6-tag (?<classes>[^"]*)" role="button"><span class="bp6-text-overflow-ellipsis bp6-fill"(?: title="(?<title>[^"]*)")?>(?<text>[^<]*)<\/span><\/span>/g;

const GROUP =
  /<div role="group" aria-label="(?<label>[^"]+)"[^>]*>(?<capsules>.*?)<\/div>/g;

const ignore = () => undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The bar, as the server would draw it.
 * @param props - what differs from a bar with nothing chosen
 * @returns the markup
 */
function barOf(props: Partial<LogFilterBarProps> = {}): string {
  return renderToStaticMarkup(
    <LogFilterBar
      minLevel="info"
      onMinLevel={ignore}
      facets={null}
      topics={[]}
      onTopics={ignore}
      roles={[]}
      onRoles={ignore}
      text=""
      onText={ignore}
      isLive
      onLive={ignore}
      onReload={ignore}
      {...props}
    />,
  );
}

/**
 * Every row of capsules, with what each capsule reads, says on hover, and
 * whether it is filled.
 * @param html - the bar
 * @returns the rows by their label
 */
function capsuleRows(html: string) {
  return Array.from(html.matchAll(GROUP), ({ groups: row }) => ({
    label: row?.label,
    capsules: Array.from(
      (row?.capsules ?? '').matchAll(CAPSULE),
      ({ groups: capsule }) => ({
        text: capsule?.text,
        title: capsule?.title,
        filled: capsule?.pressed === 'true',
        intent:
          /bp6-intent-(?<intent>\w+)/.exec(capsule?.classes ?? '')?.groups
            ?.intent ?? 'none',
      }),
    ),
  }));
}

test('the levels run from trace to fatal, each in its colour, the least severe shown filled', () => {
  expect(capsuleRows(barOf({ minLevel: 'warn' }))).toStrictEqual([
    {
      label: 'From level',
      capsules: [
        {
          text: 'trace',
          title: 'trace and worse',
          filled: false,
          intent: 'none',
        },
        {
          text: 'debug',
          title: 'debug and worse',
          filled: false,
          intent: 'none',
        },
        {
          text: 'info',
          title: 'info and worse',
          filled: false,
          intent: 'primary',
        },
        {
          text: 'warn',
          title: 'warn and worse',
          filled: true,
          intent: 'warning',
        },
        {
          text: 'error',
          title: 'error and worse',
          filled: false,
          intent: 'danger',
        },
        {
          text: 'fatal',
          title: 'fatal and worse',
          filled: false,
          intent: 'danger',
        },
      ],
    },
  ]);
});

test('topics and processes get a row once more than one has logged, saying when each last did', () => {
  const facets: LogFacetsResponse = {
    topics: [
      { name: 'http', lastAt: NOW - 5 * 60_000 },
      { name: 'db', lastAt: NOW - 2 * 3_600_000 },
    ],
    roles: [
      { name: 'server', lastAt: NOW - 1000 },
      { name: 'import', lastAt: NOW - 86_400_000 },
    ],
  };
  const rows = capsuleRows(barOf({ facets, topics: ['db'] }));

  expect(rows.slice(1)).toStrictEqual([
    {
      label: 'Topics',
      capsules: [
        {
          text: 'every topic',
          title: undefined,
          filled: false,
          intent: 'none',
        },
        {
          text: 'http',
          title: 'Last logged 5 minutes ago',
          filled: false,
          intent: 'primary',
        },
        {
          text: 'db',
          title: 'Last logged 2 hours ago',
          filled: true,
          intent: 'primary',
        },
      ],
    },
    {
      label: 'Processes',
      capsules: [
        {
          text: 'every process',
          title: undefined,
          filled: true,
          intent: 'none',
        },
        {
          text: 'server',
          title: 'Last logged just now',
          filled: false,
          intent: 'primary',
        },
        {
          text: 'import',
          title: 'Last logged yesterday',
          filled: false,
          intent: 'primary',
        },
      ],
    },
  ]);
});

test('a single topic or a single process is no choice, and gets no row', () => {
  const rows = capsuleRows(
    barOf({
      facets: {
        topics: [{ name: 'http', lastAt: NOW }],
        roles: [{ name: 'server', lastAt: NOW }],
      },
    }),
  );

  expect(rows.map((row) => row.label)).toStrictEqual(['From level']);
});

test('the search box holds the text given, and the switch says whether the lines are live', () => {
  const live = barOf({ text: 'disk full', isLive: true });
  const still = barOf({ isLive: false });

  expect(live).toContain(
    'placeholder="Text the message holds" aria-label="Text the message holds"',
  );
  expect(live).toContain('value="disk full"/>');
  expect(live).toContain(
    '<input class="bp6-control-input" type="checkbox" checked=""/>',
  );
  expect(still).toContain('<input class="bp6-control-input" type="checkbox"/>');
  expect(live).toContain(
    'aria-label="Read again" title="Read the lines and the topics again"',
  );
});
