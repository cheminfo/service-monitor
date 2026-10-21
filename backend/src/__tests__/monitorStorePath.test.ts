import { expect, test } from 'vitest';

import { monitorStorePath } from '../store/monitorStorePath.ts';

test('the store lives beside db.sqlite, in the sqlite folder of the data directory', () => {
  expect(monitorStorePath('/app/data')).toBe('/app/data/sqlite/monitor.sqlite');
  expect(monitorStorePath('data/')).toBe('data/sqlite/monitor.sqlite');
});
