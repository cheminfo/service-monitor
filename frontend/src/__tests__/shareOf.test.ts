import { expect, test } from 'vitest';

import { shareOf } from '../shareOf.ts';

test('a share stays between 0 and 1, and is 0 of nothing', () => {
  expect([
    shareOf(25, 100),
    shareOf(150, 100),
    shareOf(-5, 100),
    shareOf(5, 0),
  ]).toStrictEqual([0.25, 1, 0, 0]);
});
