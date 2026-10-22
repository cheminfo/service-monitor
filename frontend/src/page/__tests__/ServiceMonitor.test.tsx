import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { BASE_PATH } from '../../__tests__/fixtures.ts';
import { visibleTexts } from '../../__tests__/markup.ts';
import { ServiceMonitor } from '../ServiceMonitor.tsx';

const TAB =
  /aria-selected="(?<selected>true|false)" class="bp6-tab"[^>]*>(?<title>[^<]+)<\/div>/g;

/**
 * The tabs of a monitor, with whether each is the one on show.
 * @param html - the monitor
 * @returns each tab's title, and whether it is selected
 */
function tabsOf(html: string): string[] {
  return Array.from(
    html.matchAll(TAB),
    ({ groups }) =>
      `${groups?.title}${groups?.selected === 'true' ? ' (selected)' : ''}`,
  );
}

test('until the status answers, the overview says it is reading, and spins', () => {
  const html = renderToStaticMarkup(<ServiceMonitor apiBasePath={BASE_PATH} />);

  expect(tabsOf(html)).toStrictEqual([
    'Overview (selected)',
    'Processes',
    'Logs',
  ]);
  expect(visibleTexts(html)).toStrictEqual([
    'Overview',
    'Processes',
    'Logs',
    'Refresh',
    'Reading…',
  ]);
  expect(html).toContain('class="bp6-spinner"');
});

test('the logs section reads no status: no refresh, no reading note, the lines instead', () => {
  const html = renderToStaticMarkup(
    <ServiceMonitor apiBasePath={BASE_PATH} section="logs" />,
  );

  expect(tabsOf(html)).toStrictEqual([
    'Overview',
    'Processes',
    'Logs (selected)',
  ]);
  expect(html).not.toContain('Refresh');
  expect(html).not.toContain('Reading…');
  expect(html).toContain(
    '<section class="monitor-panel" aria-labelledby="monitor-logs"><h2 id="monitor-logs">Logs</h2><div class="monitor-logs" data-testid="monitor-logs">',
  );
});
