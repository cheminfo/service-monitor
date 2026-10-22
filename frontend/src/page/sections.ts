/**
 * The sections of a monitor page.
 */
export type MonitorSection = 'overview' | 'processes' | 'logs';

/**
 * The sections, in the order the tabs list them.
 */
export const MONITOR_SECTIONS: ReadonlyArray<{
  id: MonitorSection;
  title: string;
}> = [
  { id: 'overview', title: 'Overview' },
  { id: 'processes', title: 'Processes' },
  { id: 'logs', title: 'Logs' },
];

/**
 * Whether a string names a section, for a page reading it from its address.
 * @param value - the string
 * @returns whether it does
 */
export function isMonitorSection(value: unknown): value is MonitorSection {
  return MONITOR_SECTIONS.some((section) => section.id === value);
}
