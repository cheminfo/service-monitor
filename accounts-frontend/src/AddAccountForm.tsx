import { Button, Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import type { SubmitEvent } from 'react';
import { useState } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import { RoleSelect } from './RoleSelect.tsx';
import type { AccountFailure } from './accountFailure.ts';
import type { AccountSessionStore } from './accountSession.ts';
import type { AccountRole } from './rules.ts';
import {
  DEFAULT_ACCOUNT_ROLE,
  passwordProblem,
  toUsername,
  usernameProblem,
} from './rules.ts';
import { useAccountFailureText } from './useAccountFailureText.ts';

/** What a form of the Accounts page needs. */
export interface AccountFormProps {
  /** The site's session. */
  store: AccountSessionStore;
  /**
   * Called once the accounts changed, to list them again.
   * @default undefined
   */
  onChanged?: () => void;
}

/**
 * Add an account: what it signs in with, its first password and its role,
 * Read unless another is picked. A username or a password the server would
 * refuse is said before anything is sent.
 * @param props - The session, and what to do once it is added.
 * @returns The form.
 */
export function AddAccountForm(props: AccountFormProps) {
  const { store, onChanged } = props;
  const t = useChromeT();
  const text = useAccountFailureText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>(DEFAULT_ACCOUNT_ROLE);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function add(): Promise<void> {
    setAdded(null);
    const problem =
      usernameProblem(toUsername(username)) ?? passwordProblem(password);
    if (problem !== null) {
      setFailure({ code: problem, status: 400, message: '' });
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const outcome = await store.attempt(() =>
        store.client.addAccount(username.trim(), password, role),
      );
      if (outcome.ok) {
        setAdded(outcome.value.username);
        setUsername('');
        setPassword('');
        setRole(DEFAULT_ACCOUNT_ROLE);
        onChanged?.();
      } else {
        setFailure(outcome.failure);
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    void add();
  }

  return (
    <form className="accounts-form" data-testid="add-account" onSubmit={submit}>
      <FormGroup
        label={t('account.username')}
        labelFor="account-username"
        helperText={t('account.usernameHelp')}
      >
        <InputGroup
          id="account-username"
          value={username}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onValueChange={setUsername}
        />
      </FormGroup>
      <FormGroup label={t('account.password')} labelFor="account-password">
        <InputGroup
          id="account-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
        />
      </FormGroup>
      <FormGroup label={t('account.role')} labelFor="account-role">
        <RoleSelect id="account-role" value={role} onChange={setRole} />
      </FormGroup>
      {failure === null ? null : (
        <Callout intent="danger" compact role="alert">
          {text(failure)}
        </Callout>
      )}
      {added === null ? null : (
        <Callout intent="success" compact>
          {t('account.added', { username: added })}
        </Callout>
      )}
      <Button
        type="submit"
        icon="new-person"
        text={t('account.addSubmit')}
        loading={pending}
        disabled={username.trim() === '' || password === ''}
      />
    </form>
  );
}
