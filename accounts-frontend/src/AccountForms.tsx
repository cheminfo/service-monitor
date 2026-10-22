import { Button, Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import type { SubmitEvent } from 'react';
import { useState } from 'react';

import { PasswordPair } from './PasswordPair.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { pairProblem } from './passwords.ts';
import type { Account } from './types.ts';

/** What a form of the Accounts page needs. */
export interface AccountFormProps {
  /** The site's session. */
  store: AccountSessionStore;
  /** Called once the accounts changed, to list them again. */
  onChanged: () => void;
}

/**
 * Add an account: what it signs in with, and its first password.
 * @param props - The session, and what to do once it is added.
 * @returns The form.
 */
export function AddAccountForm(props: AccountFormProps) {
  const { store, onChanged } = props;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setAdded(null);
    try {
      const outcome = await store.attempt<Account>(() =>
        store.client.addAccount(username.trim(), password),
      );
      if (outcome.ok) {
        setAdded(outcome.value.username);
        setUsername('');
        setPassword('');
        onChanged();
      } else {
        setError(outcome.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="accounts-form"
      data-testid="add-account"
      onSubmit={(event) => void submit(event)}
    >
      <FormGroup
        label="Username"
        labelFor="account-username"
        helperText="Letters, digits, dots, dashes and underscores."
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
      <FormGroup label="Password" labelFor="account-password">
        <InputGroup
          id="account-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
        />
      </FormGroup>
      {error !== null && (
        <Callout intent="danger" compact role="alert">
          {error}
        </Callout>
      )}
      {added !== null && (
        <Callout intent="success" compact>
          {added} can sign in now.
        </Callout>
      )}
      <Button
        type="submit"
        icon="new-person"
        text="Add the account"
        loading={pending}
        disabled={username.trim() === '' || password === ''}
      />
    </form>
  );
}

/**
 * Change the password of the account signed in. This browser stays signed in;
 * every other session of the account ends.
 * @param props - The session, and what to do once it changed.
 * @returns The form.
 */
export function ChangePasswordForm(props: AccountFormProps) {
  const { store, onChanged } = props;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setChanged(false);
    const problem = pairProblem(next, repeat);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const outcome = await store.attempt(() =>
        store.client.changeOwnPassword(current, next),
      );
      if (outcome.ok) {
        store.renew(outcome.value);
        setChanged(true);
        setCurrent('');
        setNext('');
        setRepeat('');
        onChanged();
      } else {
        setError(outcome.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="accounts-form"
      data-testid="change-password"
      onSubmit={(event) => void submit(event)}
    >
      <FormGroup label="Current password" labelFor="current-password">
        <InputGroup
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onValueChange={setCurrent}
        />
      </FormGroup>
      <PasswordPair
        id="new-password"
        next={next}
        repeat={repeat}
        onNext={setNext}
        onRepeat={setRepeat}
      />
      {error !== null && (
        <Callout intent="danger" compact role="alert">
          {error}
        </Callout>
      )}
      {changed && (
        <Callout intent="success" compact>
          Your password is changed. Other browsers signed in as you are signed
          out.
        </Callout>
      )}
      <Button
        type="submit"
        icon="key"
        text="Change your password"
        loading={pending}
        disabled={current === '' || next === '' || repeat === ''}
      />
    </form>
  );
}
