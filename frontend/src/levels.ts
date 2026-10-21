import type { Intent } from '@blueprintjs/core';

import type { LogLevel } from './types.ts';

/**
 * The levels, the least severe first.
 */
export const LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
];

/**
 * The colour each level is read in.
 */
export const LEVEL_INTENT: Readonly<Record<LogLevel, Intent>> = {
  trace: 'none',
  debug: 'none',
  info: 'primary',
  warn: 'warning',
  error: 'danger',
  fatal: 'danger',
};
