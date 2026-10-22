import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
} from '@blueprintjs/core';
import type { SubmitEvent } from 'react';
import { useState } from 'react';

import { PasswordPair } from './PasswordPair.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { pairProblem } from './passwords.ts';
import type { Account } from './types.ts';

/** What the dialog setting another account's password needs. */
export interface SetPasswordDialogProps {
  /** The site's session. */
  store: AccountSessionStore;
  /** The account. */
  account: Account;
  /** Closes the dialog, after the password was set or not. */
  onClose: (changed: boolean) => void;
}

/**
 * Set another account's password, for somebody who forgot theirs. Every
 * session of that account ends.
 * @param props - The session, the account, and how to close the dialog.
 * @returns The dialog.
 */
export function SetPasswordDialog(props: SetPasswordDialogProps) {
  const { store, account, onClose } = props;
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = pairProblem(next, repeat);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const outcome = await store.attempt(() =>
        store.client.setPassword(account.id, next),
      );
      if (outcome.ok) onClose(true);
      else setError(outcome.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      isOpen
      title={`Set the password of ${account.username}`}
      icon="key"
      onClose={() => onClose(false)}
    >
      <form data-testid="set-password" onSubmit={(event) => void submit(event)}>
        <DialogBody className="accounts-form">
          <p className="accounts-note">
            {account.username} is signed out everywhere, and signs in with this
            password from now on.
          </p>
          <PasswordPair
            id="set-password"
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
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button
                type="button"
                text="Cancel"
                onClick={() => onClose(false)}
              />
              <Button
                type="submit"
                intent="primary"
                text="Set the password"
                loading={pending}
                disabled={next === '' || repeat === ''}
              />
            </>
          }
        />
      </form>
    </Dialog>
  );
}
