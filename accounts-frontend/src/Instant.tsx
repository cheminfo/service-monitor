import { useMemo } from 'react';
import { formatRelativeTime } from 'react-cheminfo/core';
import { useLanguage } from 'react-cheminfo/ui';

/** What an instant needs. */
export interface InstantProps {
  /** Unix seconds. */
  seconds: number;
  /**
   * Whether to write how long ago it was rather than the date.
   * @default false
   */
  relative?: boolean;
}

/**
 * An instant, as a date or as how long ago it was, in the language of the
 * page, with the exact time to the minute in its tooltip. Written in UTC, the
 * time the server's own log is read in.
 * @param props - The instant, and how to write it.
 * @returns The time element.
 */
export function Instant(props: InstantProps) {
  const { seconds, relative = false } = props;
  const language = useLanguage();
  const formats = useMemo(
    () => ({
      date: new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      exact: new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }),
    }),
    [language],
  );
  const date = new Date(seconds * 1000);

  return (
    <time dateTime={date.toISOString()} title={formats.exact.format(date)}>
      {relative
        ? formatRelativeTime(date, { locale: language })
        : formats.date.format(date)}
    </time>
  );
}
