import { Button, Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import type { ReactNode, SubmitEvent } from 'react';
import { useState } from 'react';

import type { AccountSessionStore } from './accountSession.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the sign-in form needs. */
export interface SignInFormProps {
  /** The site's session. */
  store: AccountSessionStore;
  /**
   * What the form is headed with.
   * @default 'Sign in'
   */
  title?: ReactNode;
  /**
   * One line under the title: what signing in gives access to.
   * @default undefined
   */
  note?: ReactNode;
}

/**
 * Sign in with a username and a password. The cookie the server answers with
 * is the browser's: nothing is kept here.
 * @param props - The session, and what the form says.
 * @returns The form.
 */
export function SignInForm(props: SignInFormProps) {
  const { store, title = 'Sign in', note } = props;
  const { notice } = useAccountSession(store);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = error ?? notice;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const outcome = await store.signIn(username, password);
      if (!outcome.ok) {
        setError(outcome.error);
        setPassword('');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="accounts-sign-in">
      <form
        className="accounts-panel accounts-form"
        aria-labelledby="accounts-sign-in-title"
        data-testid="sign-in"
        onSubmit={(event) => void submit(event)}
      >
        <h1 id="accounts-sign-in-title">{title}</h1>
        {note === undefined ? null : <p className="accounts-note">{note}</p>}
        <FormGroup label="Username" labelFor="accounts-username">
          <InputGroup
            id="accounts-username"
            name="username"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onValueChange={setUsername}
          />
        </FormGroup>
        <FormGroup label="Password" labelFor="accounts-password">
          <InputGroup
            id="accounts-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onValueChange={setPassword}
          />
        </FormGroup>
        {shown !== null && (
          <Callout intent="danger" compact role="alert">
            {shown}
          </Callout>
        )}
        <Button
          type="submit"
          intent="primary"
          text="Sign in"
          fill
          loading={pending}
          disabled={username === '' || password === ''}
        />
      </form>
    </div>
  );
}
