import type { Intent } from '@blueprintjs/core';
import { Icon } from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';

import type { HealthCheck } from './types.ts';

const LOOK: Record<HealthCheck['level'], { icon: IconName; intent: Intent }> = {
  error: { icon: 'error', intent: 'danger' },
  warning: { icon: 'warning-sign', intent: 'warning' },
  info: { icon: 'info-sign', intent: 'primary' },
  ok: { icon: 'tick-circle', intent: 'success' },
};

/**
 * What the server judged, in the order it judged it: the worst first, then
 * what is in progress, then what was looked at and found fine.
 * @param props - The checks.
 * @param props.checks - The judgements, as the server ordered them.
 * @returns The list.
 */
export function HealthChecks(props: { checks: readonly HealthCheck[] }) {
  return (
    <ul className="monitor-checks" data-testid="monitor-checks">
      {props.checks.map((check) => {
        const look = LOOK[check.level];
        return (
          <li
            key={check.id}
            className={`monitor-check monitor-check--${check.level}`}
          >
            <Icon icon={look.icon} intent={look.intent} size={14} />
            <span>{check.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
