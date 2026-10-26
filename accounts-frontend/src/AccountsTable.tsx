import { Button, Tag } from '@blueprintjs/core';
import { ConfirmButton, useChromeT } from 'react-cheminfo/ui';

import { Instant } from './Instant.tsx';
import { RoleSelect } from './RoleSelect.tsx';
import { ROLE_LABEL_KEYS } from './roleLabels.ts';
import type { AccountRole } from './rules.ts';
import type { Account } from './types.ts';

/** What the table of the accounts needs. */
export interface AccountsTableProps {
  /** The accounts, by username. */
  accounts: readonly Account[];
  /** The username signed in, whose row cannot be changed here. */
  me: string | null;
  /** Opens the dialog setting an account's password. */
  onSetPassword: (account: Account) => void;
  /** Gives an account another role. */
  onRole: (account: Account, role: AccountRole) => void;
  /** Removes an account, once confirmed. */
  onRemove: (account: Account) => void;
}

/**
 * The accounts, one row each: what it signs in with, its role, when it was
 * added, last signed in and changed its password, and what can be done to
 * it. Your own row and the one the `.env` defines are read only.
 * @param props - The accounts, and what the controls do.
 * @returns The table.
 */
export function AccountsTable(props: AccountsTableProps) {
  const { accounts, me, onSetPassword, onRole, onRemove } = props;
  const t = useChromeT();

  return (
    <div className="accounts-scroll">
      <table className="accounts-table" data-testid="accounts-table">
        <thead>
          <tr>
            <th>{t('account.username')}</th>
            <th>{t('account.role')}</th>
            <th>{t('account.column.added')}</th>
            <th>{t('account.column.lastSignIn')}</th>
            <th>{t('account.column.passwordChanged')}</th>
            <th aria-label={t('account.column.actions')} />
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              isMe={account.username === me}
              onSetPassword={() => onSetPassword(account)}
              onRole={(role) => onRole(account, role)}
              onRemove={() => onRemove(account)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One account, and what can be done to it.
 * @param props - The account, whether it is yours, and what the controls do.
 * @param props.account - The account.
 * @param props.isMe - Whether it is the one signed in.
 * @param props.onSetPassword - Opens the dialog setting its password.
 * @param props.onRole - Gives it another role.
 * @param props.onRemove - Removes it, once confirmed.
 * @returns The row.
 */
function AccountRow(props: {
  account: Account;
  isMe: boolean;
  onSetPassword: () => void;
  onRole: (role: AccountRole) => void;
  onRemove: () => void;
}) {
  const { account, isMe, onSetPassword, onRole, onRemove } = props;
  const t = useChromeT();
  const {
    username,
    role,
    envManaged,
    createdAt,
    lastSignInAt,
    passwordChangedAt,
  } = account;
  const fixed = isMe || envManaged;

  return (
    <tr data-testid={`account-${username}`}>
      <td>
        <code>{username}</code>
        {isMe ? (
          <Tag minimal intent="primary" className="accounts-table__tag">
            {t('account.you')}
          </Tag>
        ) : null}
        {envManaged ? (
          <Tag
            minimal
            className="accounts-table__tag"
            title={t('account.envManagedTitle')}
          >
            {t('account.envManaged')}
          </Tag>
        ) : null}
      </td>
      <td>
        {fixed ? (
          t(ROLE_LABEL_KEYS[role])
        ) : (
          <RoleSelect
            value={role}
            ariaLabel={t('account.roleOf', { username })}
            onChange={onRole}
          />
        )}
      </td>
      <td>
        <Instant seconds={createdAt} />
      </td>
      <td>
        {lastSignInAt === null ? (
          t('account.never')
        ) : (
          <Instant seconds={lastSignInAt} relative />
        )}
      </td>
      <td>
        <Instant seconds={passwordChangedAt} />
      </td>
      <td className="accounts-table__action">
        {fixed ? null : (
          <>
            <Button
              variant="minimal"
              size="small"
              icon="key"
              text={t('account.setPassword')}
              onClick={onSetPassword}
            />
            <ConfirmButton
              variant="minimal"
              size="small"
              intent="danger"
              icon="trash"
              text={t('account.remove')}
              confirmLabel={t('account.remove')}
              question={t('account.removeQuestion', { username })}
              onConfirm={onRemove}
            />
          </>
        )}
      </td>
    </tr>
  );
}
