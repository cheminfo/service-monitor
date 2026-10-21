import type { LogLevel } from './types.ts';

/**
 * pino's numbers for the levels, which fifo-logger shares.
 */
export const LEVEL_VALUES: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

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
 * Lines at this level and above are problems, and are kept longer.
 */
export const PROBLEM_LEVEL = LEVEL_VALUES.warn;

/**
 * The name of a level number. A number between two levels takes the lower
 * one's name, as pino's custom levels would.
 * @param value - pino's number for it
 * @returns its name
 */
export function levelLabelOf(value: number): LogLevel {
  let label: LogLevel = 'trace';
  for (const level of LEVELS) {
    if (value >= LEVEL_VALUES[level]) label = level;
  }
  return label;
}

/**
 * Whether a string names a level.
 * @param value - the string
 * @returns whether it does
 */
export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVEL_VALUES, value);
}
