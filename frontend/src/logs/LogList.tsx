import { Tag } from '@blueprintjs/core';

import { LEVEL_INTENT } from '../levels.ts';
import type { LogEntry } from '../types.ts';

import { formatLogTime } from './logLines.ts';

/**
 * What the list shows.
 */
export interface LogListProps {
  /**
   * The lines, the newest first.
   */
  lines: readonly LogEntry[];
  /**
   * The lines whose other fields are unfolded.
   */
  expanded: ReadonlySet<number>;
  /**
   * Fold or unfold a line.
   */
  onToggle: (id: number) => void;
  /**
   * The current instant, in unix milliseconds, so a line of today shows its
   * time alone.
   */
  now: number;
}

/**
 * The lines, one a row: when, how severe, which topic, which process, and
 * what it said. A line that carried other fields unfolds to show them, an
 * error's stack among them.
 * @param props - See {@link LogListProps}.
 * @returns The list.
 */
export function LogList(props: LogListProps) {
  const { lines, expanded, onToggle, now } = props;
  if (lines.length === 0) {
    return <p className="monitor-note">Nothing was logged that matches.</p>;
  }
  return (
    <ol className="monitor-log" data-testid="monitor-log">
      {lines.map((line) => {
        const isOpen = expanded.has(line.id);
        const head = (
          <>
            <time
              dateTime={new Date(line.at).toISOString()}
              title={new Date(line.at).toISOString()}
            >
              {formatLogTime(line.at, now)}
            </time>
            <Tag
              minimal
              intent={LEVEL_INTENT[line.levelLabel]}
              className="monitor-log__level"
            >
              {line.levelLabel}
            </Tag>
            <span className="monitor-log__topic">{line.topic}</span>
            <span
              className="monitor-log__role"
              title={`pid ${line.pid} on ${line.hostname}`}
            >
              {line.role}
            </span>
            <span className="monitor-log__text">{line.message}</span>
          </>
        );
        return (
          <li
            key={line.id}
            className={`monitor-log__line monitor-log__line--${line.levelLabel}`}
          >
            {line.meta === null ? (
              <div className="monitor-log__head">{head}</div>
            ) : (
              <button
                type="button"
                className="monitor-log__head monitor-log__head--more"
                aria-expanded={isOpen}
                onClick={() => onToggle(line.id)}
              >
                {head}
              </button>
            )}
            {isOpen && line.meta !== null && (
              <pre className="monitor-log__meta">
                {JSON.stringify(line.meta, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}
