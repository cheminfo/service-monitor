import {
  formatDuration,
  formatInteger,
  formatRelativeTime,
} from 'react-cheminfo/core';

import type { Activity } from './types.ts';

/**
 * One figure of an activity, written by what its name says it is: an instant
 * (`…At`), a duration (`…Ms`) or a count.
 * @param name - the figure's name
 * @param value - its value
 * @returns the figure, as the page writes it
 */
export function activityValue(name: string, value: Activity[string]): string {
  if (typeof value !== 'number') return String(value);
  if (name.endsWith('At')) return formatRelativeTime(value);
  if (name.endsWith('Ms')) return formatDuration(value);
  return formatInteger(value);
}
