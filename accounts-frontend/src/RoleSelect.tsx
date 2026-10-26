import { HTMLSelect } from '@blueprintjs/core';
import { useChromeT } from 'react-cheminfo/ui';

import { ROLE_LABEL_KEYS } from './roleLabels.ts';
import type { AccountRole } from './rules.ts';
import { ACCOUNT_ROLES, isAccountRole } from './rules.ts';

/** What the role picker needs. */
export interface RoleSelectProps {
  /** The role picked. */
  value: AccountRole;
  /** Called with the role picked. */
  onChange: (role: AccountRole) => void;
  /**
   * The id of the select, for a label pointing at it.
   * @default undefined
   */
  id?: string;
  /**
   * What names the select to a screen reader, without a visible label.
   * @default undefined
   */
  ariaLabel?: string;
  /**
   * Whether it is greyed, while a change is on its way.
   * @default false
   */
  disabled?: boolean;
}

/**
 * The three roles in the words of the page: Read, Read and write,
 * Administrator.
 * @param props - The role, and what picking one does.
 * @returns The select.
 */
export function RoleSelect(props: RoleSelectProps) {
  const { value, onChange, id, ariaLabel, disabled = false } = props;
  const t = useChromeT();

  return (
    <HTMLSelect
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      minimal
      options={ACCOUNT_ROLES.map((role) => ({
        value: role,
        label: t(ROLE_LABEL_KEYS[role]),
      }))}
      onChange={(event) => {
        if (isAccountRole(event.currentTarget.value)) {
          onChange(event.currentTarget.value);
        }
      }}
    />
  );
}
