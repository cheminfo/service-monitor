import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

test('the contract is the backend’s, byte for byte', () => {
  const here = readFileSync(join(import.meta.dirname, '../types.ts'));
  const backend = readFileSync(
    join(import.meta.dirname, '../../../accounts-backend/src/types.ts'),
  );

  expect(here.equals(backend)).toBe(true);
});
