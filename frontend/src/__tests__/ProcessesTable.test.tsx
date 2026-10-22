import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { ProcessesTable } from '../ProcessesTable.tsx';

import { IMPORT, NOW, SERVER } from './fixtures.ts';
import { visibleTexts } from './markup.ts';

test('with no process reporting yet, there is a sentence and no table', () => {
  expect(
    renderToStaticMarkup(<ProcessesTable processes={[]} now={NOW} />),
  ).toBe('<p class="monitor-note">No process reports yet.</p>');
});

test('every process is a row: what it is, whether it reports, its resources and what it does', () => {
  const html = renderToStaticMarkup(
    <ProcessesTable processes={[SERVER, IMPORT]} now={NOW} />,
  );

  expect(visibleTexts(html)).toStrictEqual([
    'Process',
    'State',
    'Up',
    'CPU',
    'Memory',
    'Loop delay',
    'Doing',
    'server',
    'pid 4012 on web-1',
    'reporting',
    'just now',
    '2h 05m',
    '4%',
    '180 MB',
    'heap 64.0 MB',
    '12 ms',
    'requests',
    '1,204',
    'import',
    'pid 4100 on worker-1',
    'silent',
    '20 minutes ago',
    '45s',
    '97%',
    '1.5 GB',
    'heap 900 MB',
    '1,850 ms',
    'phase',
    'parsing',
    'parsedMs',
    '1m 30s',
    'entries',
    '—',
  ]);
});

test('a process that reports is green, and one that went silent is red', () => {
  const html = renderToStaticMarkup(
    <ProcessesTable processes={[SERVER, IMPORT]} now={NOW} />,
  );

  expect(
    Array.from(
      html.matchAll(
        /<span class="bp6-tag bp6-intent-(?<intent>\w+) bp6-minimal"><span[^>]*>(?<state>\w+)<\/span>/g,
      ),
      (match) => `${match.groups?.state} ${match.groups?.intent}`,
    ),
  ).toStrictEqual(['reporting success', 'silent danger']);
});

test('a process that says nothing of what it does shows a dash', () => {
  const html = renderToStaticMarkup(
    <ProcessesTable processes={[{ ...SERVER, activity: {} }]} now={NOW} />,
  );

  expect(html).toContain('<td><span class="monitor-faint">—</span></td>');
  expect(html).not.toContain('monitor-activity');
});
