import { Button, Callout, Spinner, Tag } from '@blueprintjs/core';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmButton } from 'react-cheminfo/ui';

import { AddAccountForm, ChangePasswordForm } from './AccountForms.tsx';
import { Instant } from './Instant.tsx';
import { SetPasswordDialog } from './SetPasswordDialog.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import type { Account } from './types.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the Accounts page needs. */
export interface AccountsPageProps {
  /** The site's session; the page is drawn behind its gate. */
  store: AccountSessionStore;
}

/**
 * The accounts that sign in here, the way to add one, and the way to change
 * your own password. Every account can do everything on this page.
 * @param props - The site's session.
 * @returns The page.
 */
export function AccountsPage(props: AccountsPageProps) {
  const { store } = props;
  const me = useAccountSession(store).session?.username ?? null;
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<Account | null>(null);

  const reload = useCallback(async () => {
    const outcome = await store.attempt(() => store.client.accounts());
    if (outcome.ok) {
      setAccounts(outcome.value);
      setError(null);
    } else {
      setError(outcome.error);
    }
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(account: Account) {
    const outcome = await store.attempt(() =>
      store.client.removeAccount(account.id),
    );
    if (outcome.ok) await reload();
    else setError(outcome.error);
  }

  return (
    <div className="accounts-page" data-testid="accounts-page">
      <section className="accounts-panel" aria-labelledby="accounts-list">
        <h2 id="accounts-list">Accounts</h2>
        <p className="accounts-note">Every account can do everything here.</p>
        {error !== null && (
          <Callout intent="danger" compact role="alert">
            {error}
          </Callout>
        )}
        {accounts === null ? (
          error === null && <Spinner size={24} />
        ) : (
          <div className="accounts-scroll">
            <table className="accounts-table" data-testid="accounts-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Added</th>
                  <th>Last sign-in</th>
                  <th>Password changed</th>
                  <th aria-label="Change" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    isMe={account.username === me}
                    onSetPassword={() => setSetting(account)}
                    onRemove={() => void remove(account)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="accounts-page__side">
        <section className="accounts-panel" aria-labelledby="accounts-own">
          <h2 id="accounts-own">Change your password</h2>
          <ChangePasswordForm store={store} onChanged={() => void reload()} />
        </section>
        <section className="accounts-panel" aria-labelledby="accounts-add">
          <h2 id="accounts-add">Add an account</h2>
          <AddAccountForm store={store} onChanged={() => void reload()} />
        </section>
      </div>

      {setting !== null && (
        <SetPasswordDialog
          key={setting.id}
          store={store}
          account={setting}
          onClose={(changed) => {
            setSetting(null);
            if (changed) void reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * One account, and what can be done to it: nothing to your own, which you
 * change in the form beside the list.
 * @param props - The account, whether it is yours, and what the buttons do.
 * @param props.account - The account.
 * @param props.isMe - Whether it is the one signed in.
 * @param props.onSetPassword - Opens the dialog setting its password.
 * @param props.onRemove - Removes it, once confirmed.
 * @returns The row.
 */
function AccountRow(props: {
  account: Account;
  isMe: boolean;
  onSetPassword: () => void;
  onRemove: () => void;
}) {
  const { account, isMe, onSetPassword, onRemove } = props;

  return (
    <tr data-testid={`account-${account.username}`}>
      <td>
        <code>{account.username}</code>
        {isMe && (
          <Tag minimal intent="primary" className="accounts-table__you">
            you
          </Tag>
        )}
      </td>
      <td>
        <Instant seconds={account.createdAt} />
      </td>
      <td>
        {account.lastSignInAt === null ? (
          'never'
        ) : (
          <Instant seconds={account.lastSignInAt} relative />
        )}
      </td>
      <td>
        <Instant seconds={account.passwordChangedAt} />
      </td>
      <td className="accounts-table__action">
        {!isMe && (
          <>
            <Button
              variant="minimal"
              size="small"
              icon="key"
              text="Set password"
              onClick={onSetPassword}
            />
            <ConfirmButton
              variant="minimal"
              size="small"
              intent="danger"
              icon="trash"
              text="Remove"
              confirmLabel="Remove"
              question={
                <>
                  Remove <code>{account.username}</code>? It can no longer sign
                  in.
                </>
              }
              onConfirm={onRemove}
            />
          </>
        )}
      </td>
    </tr>
  );
}
