import { Callout, Spinner } from '@blueprintjs/core';
import { useCallback, useState } from 'react';
import { useAsync, useChromeT } from 'react-cheminfo/ui';

import { AccountsTable } from './AccountsTable.tsx';
import { AddAccountForm } from './AddAccountForm.tsx';
import { ChangePasswordForm } from './ChangePasswordForm.tsx';
import { SetPasswordDialog } from './SetPasswordDialog.tsx';
import type { AccountFailure } from './accountFailure.ts';
import type { AccountSessionStore } from './accountSession.ts';
import type { Account } from './types.ts';
import { useAccountFailureText } from './useAccountFailureText.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the Accounts page needs. */
export interface AccountsPageProps {
  /**
   * The site's session. The page is an administrator's: draw it behind
   * `<SignInGate store={…} role="admin">`.
   */
  store: AccountSessionStore;
}

/**
 * The accounts that sign in here, each with its role, the way to add one,
 * and the way to change your own password: the administrator's page.
 * @param props - The site's session.
 * @returns The page.
 */
export function AccountsPage(props: AccountsPageProps) {
  const { store } = props;
  const t = useChromeT();
  const text = useAccountFailureText();
  const me = useAccountSession(store).session?.username ?? null;
  const [refresh, setRefresh] = useState(0);
  const [changeFailure, setChangeFailure] = useState<AccountFailure | null>(
    null,
  );
  const [setting, setSetting] = useState<Account | null>(null);

  const list = useCallback(
    () => store.attempt(() => store.client.accounts()),
    [store],
  );
  const listed = useAsync(list, refresh);
  const accounts = listed.data?.ok === true ? listed.data.value : null;
  const failure =
    changeFailure ?? (listed.data?.ok === false ? listed.data.failure : null);

  function reload(): void {
    setChangeFailure(null);
    setRefresh((count) => count + 1);
  }

  async function change(request: () => Promise<unknown>): Promise<void> {
    const outcome = await store.attempt(request);
    if (outcome.ok) reload();
    else setChangeFailure(outcome.failure);
  }

  const mine = accounts?.find((account) => account.username === me);

  return (
    <div className="accounts-page" data-testid="accounts-page">
      <section className="accounts-panel" aria-labelledby="accounts-list">
        <h2 id="accounts-list">{t('account.accounts')}</h2>
        <p className="accounts-note">{t('account.accountsNote')}</p>
        {failure === null ? null : (
          <Callout intent="danger" compact role="alert">
            {text(failure)}
          </Callout>
        )}
        {accounts === null ? (
          failure === null && <Spinner size={24} />
        ) : (
          <AccountsTable
            accounts={accounts}
            me={me}
            onSetPassword={setSetting}
            onRole={(account, role) =>
              void change(() => store.client.setRole(account.id, role))
            }
            onRemove={(account) =>
              void change(() => store.client.removeAccount(account.id))
            }
          />
        )}
      </section>

      <div className="accounts-page__side">
        <section className="accounts-panel" aria-labelledby="accounts-own">
          <h2 id="accounts-own">{t('account.changePassword')}</h2>
          {mine?.envManaged ? (
            <p className="accounts-note">{t('account.ownEnvManaged')}</p>
          ) : (
            <ChangePasswordForm store={store} onChanged={reload} />
          )}
        </section>
        <section className="accounts-panel" aria-labelledby="accounts-add">
          <h2 id="accounts-add">{t('account.add')}</h2>
          <AddAccountForm store={store} onChanged={reload} />
        </section>
      </div>

      {setting === null ? null : (
        <SetPasswordDialog
          key={setting.id}
          store={store}
          account={setting}
          onClose={(changed) => {
            setSetting(null);
            if (changed) reload();
          }}
        />
      )}
    </div>
  );
}
