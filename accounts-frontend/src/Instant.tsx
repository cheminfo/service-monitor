import { formatRelativeTime } from 'react-cheminfo/core';

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
 * An instant, as a date or as how long ago it was, with the exact time to the
 * minute in its tooltip.
 * @param props - The instant, and how to write it.
 * @returns The time element.
 */
export function Instant(props: InstantProps) {
  const date = new Date(props.seconds * 1000);
  const iso = date.toISOString();

  return (
    <time dateTime={iso} title={`${iso.slice(0, 16).replace('T', ' ')} UTC`}>
      {props.relative ? formatRelativeTime(date) : iso.slice(0, 10)}
    </time>
  );
}
