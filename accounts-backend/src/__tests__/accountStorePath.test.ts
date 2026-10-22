import { expect, test } from 'vitest';

import { accountStorePath } from '../store/accountStorePath.ts';

test('the store lives beside db.sqlite, in the sqlite folder of the data directory', () => {
  expect(accountStorePath('/app/data')).toBe(
    '/app/data/sqlite/accounts.sqlite',
  );
  expect(accountStorePath('data/')).toBe('data/sqlite/accounts.sqlite');
});
