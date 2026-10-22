import { expect, test } from 'vitest';

import { MONITOR_SECTIONS, isMonitorSection } from '../page/sections.ts';

test('the tabs list the overview, the processes and the logs, in that order', () => {
  expect(MONITOR_SECTIONS.map((section) => section.id)).toStrictEqual([
    'overview',
    'processes',
    'logs',
  ]);
});

test('only a section the page has is read from an address', () => {
  expect(
    ['logs', 'overview', 'history', '', undefined].map(isMonitorSection),
  ).toStrictEqual([true, true, false, false, false]);
});
