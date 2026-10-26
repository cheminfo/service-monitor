import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

test('the contract and its rules are the backend’s, byte for byte', () => {
  for (const file of ['types.ts', 'rules.ts']) {
    const here = readFileSync(join(import.meta.dirname, '..', file));
    const backend = readFileSync(
      join(import.meta.dirname, '../../../accounts-backend/src', file),
    );

    expect([file, here.equals(backend)]).toStrictEqual([file, true]);
  }
});
