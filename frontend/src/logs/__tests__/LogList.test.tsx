import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { NOW, logLine } from '../../__tests__/fixtures.ts';
import { decodeEntities, visibleTexts } from '../../__tests__/markup.ts';
import type { LogEntry } from '../../types.ts';
import { LogList } from '../LogList.tsx';

const SLOW_QUERY = logLine(41, {
  at: NOW - 9000,
  level: 40,
  levelLabel: 'warn',
  topic: 'db',
  role: 'import',
  pid: 4100,
  hostname: 'worker-1',
  message: 'A query took 1.2 s',
  meta: { sql: 'SELECT 1', durationMs: 1200 },
});

/**
 * The list, as the server would draw it.
 * @param lines - the lines, the newest first
 * @param expanded - the lines unfolded
 * @returns the markup
 */
function listOf(lines: LogEntry[], expanded: number[] = []): string {
  return renderToStaticMarkup(
    <LogList
      lines={lines}
      expanded={new Set(expanded)}
      onToggle={() => undefined}
      now={NOW}
    />,
  );
}

test('with no line to show, the list says nothing matched', () => {
  expect(listOf([])).toBe(
    '<p class="monitor-note">Nothing was logged that matches.</p>',
  );
});

test('each line reads when, how severe, which topic, which process, and what it said', () => {
  const html = listOf([logLine(42), SLOW_QUERY]);

  expect(visibleTexts(html)).toStrictEqual([
    '14:03:05',
    'info',
    'http',
    'server',
    'request 42',
    '14:02:58',
    'warn',
    'db',
    'import',
    'A query took 1.2 s',
  ]);
  expect(
    Array.from(
      html.matchAll(/<li class="(?<name>[^"]+)">/g),
      (match) => match.groups?.name,
    ),
  ).toStrictEqual([
    'monitor-log__line monitor-log__line--info',
    'monitor-log__line monitor-log__line--warn',
  ]);
  expect(
    Array.from(
      html.matchAll(
        /bp6-tag bp6-intent-(?<intent>\w+) bp6-minimal monitor-log__level/g,
      ),
      (match) => match.groups?.intent,
    ),
  ).toStrictEqual(['primary', 'warning']);
});

test('the process names its pid and machine on hover, and the time its instant', () => {
  const at = NOW - 9000;
  const html = listOf([SLOW_QUERY]);
  const instant = new Date(at).toISOString();

  expect(html).toContain(
    '<span class="monitor-log__role" title="pid 4100 on worker-1">import</span>',
  );
  expect(html).toContain(
    `<time dateTime="${instant}" title="${instant}">14:02:58</time>`,
  );
});

test('a line of an earlier day carries its date', () => {
  const html = listOf([
    logLine(7, { at: new Date(2026, 9, 20, 23, 59, 59).getTime() }),
  ]);

  expect(visibleTexts(html)[0]).toBe('20 Oct, 23:59:59');
});

test('a line with other fields is a button that unfolds them, a line without is not', () => {
  const html = listOf([logLine(42), SLOW_QUERY]);

  expect(html).toContain('<div class="monitor-log__head"><time');
  expect(html).toContain(
    '<button type="button" class="monitor-log__head monitor-log__head--more" aria-expanded="false">',
  );
  expect(html).not.toContain('<pre');
});

test('an unfolded line shows its other fields as indented JSON', () => {
  const html = listOf([logLine(42), SLOW_QUERY], [41]);

  expect(html).toContain('aria-expanded="true"');
  expect(
    Array.from(
      html.matchAll(/<pre class="monitor-log__meta">(?<json>[^<]*)<\/pre>/g),
      (match) => decodeEntities(match.groups?.json ?? ''),
    ),
  ).toStrictEqual(['{\n  "sql": "SELECT 1",\n  "durationMs": 1200\n}']);
});

test('a line without other fields stays folded even when asked to unfold', () => {
  expect(listOf([logLine(42)], [42])).not.toContain('<pre');
});
