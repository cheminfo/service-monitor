import { expect, test } from 'vitest';

import { activityValue } from '../activityValue.ts';

test('a figure is written by what its name says it is', () => {
  expect([
    activityValue('phase', 'parsing'),
    activityValue('done', false),
    activityValue('entries', 1_204_000),
    activityValue('elapsedMs', 90_000),
  ]).toStrictEqual(['parsing', 'false', '1,204,000', '1m 30s']);
});
