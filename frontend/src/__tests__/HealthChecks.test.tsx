import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { HealthChecks } from '../HealthChecks.tsx';

import { visibleTexts } from './markup.ts';

test('every check is a line in the colour of its level, in the order the server gave', () => {
  const html = renderToStaticMarkup(
    <HealthChecks
      checks={[
        { id: 'disk', level: 'error', message: 'The data volume is full.' },
        { id: 'memory', level: 'warning', message: 'Memory is short.' },
        { id: 'import', level: 'info', message: 'An import runs.' },
        { id: 'processes', level: 'ok', message: 'Every process reports.' },
      ]}
    />,
  );

  expect(
    Array.from(
      html.matchAll(/<li class="(?<name>[^"]+)">/g),
      (match) => match.groups?.name,
    ),
  ).toStrictEqual([
    'monitor-check monitor-check--error',
    'monitor-check monitor-check--warning',
    'monitor-check monitor-check--info',
    'monitor-check monitor-check--ok',
  ]);
  expect(
    Array.from(
      html.matchAll(
        /class="bp6-icon bp6-icon-(?<icon>[\w-]+) bp6-intent-(?<intent>\w+)"/g,
      ),
      (match) => `${match.groups?.icon} ${match.groups?.intent}`,
    ),
  ).toStrictEqual([
    'error danger',
    'warning-sign warning',
    'info-sign primary',
    'tick-circle success',
  ]);
  expect(visibleTexts(html)).toStrictEqual([
    'The data volume is full.',
    'Memory is short.',
    'An import runs.',
    'Every process reports.',
  ]);
});

test('with no check, the list is empty', () => {
  expect(renderToStaticMarkup(<HealthChecks checks={[]} />)).toBe(
    '<ul class="monitor-checks" data-testid="monitor-checks"></ul>',
  );
});
