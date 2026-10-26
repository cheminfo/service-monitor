import type { SubmitEvent } from 'react';
import { useState } from 'react';

import type { AccountFailure } from './accountFailure.ts';
import type { AccountSessionStore } from './accountSession.ts';
import { useAccountFailureText } from './useAccountFailureText.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the sign-in fields read and write, shared by the form and the dialog. */
export interface SignInState {
  /** The username, as typed. */
  username: string;
  /** Types the username. */
  setUsername: (value: string) => void;
  /** The password, as typed. */
  password: string;
  /** Types the password. */
  setPassword: (value: string) => void;
  /** Whether the server is being asked. */
  pending: boolean;
  /** Why signing in was refused, or why it is asked again; else null. */
  error: string | null;
  /** Whether both fields are filled. */
  ready: boolean;
  /** Signs in with what was typed. */
  submit: (event: SubmitEvent<HTMLFormElement>) => void;
}

/**
 * The state of a sign-in: the two fields, the request, and the refusal in
 * the language of the page. A refused password is cleared, so the next try
 * starts on an empty field.
 * @param store - the site's session
 * @param onSignedIn - called once signed in
 * @returns the state
 */
export function useSignIn(
  store: AccountSessionStore,
  onSignedIn?: () => void,
): SignInState {
  const { notice } = useAccountSession(store);
  const text = useAccountFailureText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const shown = failure ?? notice;

  async function signIn(): Promise<void> {
    setPending(true);
    try {
      const outcome = await store.signIn(username, password);
      setPassword('');
      if (outcome.ok) {
        setFailure(null);
        onSignedIn?.();
      } else {
        setFailure(outcome.failure);
      }
    } finally {
      setPending(false);
    }
  }

  return {
    username,
    setUsername,
    password,
    setPassword,
    pending,
    error: shown === null ? null : text(shown),
    ready: username !== '' && password !== '',
    submit: (event) => {
      event.preventDefault();
      void signIn();
    },
  };
}
