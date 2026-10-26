import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
} from '@blueprintjs/core';
import type { SubmitEvent } from 'react';
import { useState } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import { PasswordPair } from './PasswordPair.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { passwordProblem } from './rules.ts';
import type { Account } from './types.ts';
import { useAccountFailureText } from './useAccountFailureText.ts';

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
  const t = useChromeT();
  const text = useAccountFailureText();
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { id, username } = account;

  async function set(): Promise<void> {
    if (next !== repeat) {
      setError(t('account.passwordsDiffer'));
      return;
    }
    const problem = passwordProblem(next);
    if (problem !== null) {
      setError(text({ code: problem, status: 400, message: '' }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const outcome = await store.attempt(() =>
        store.client.setPassword(id, next),
      );
      if (outcome.ok) onClose(true);
      else setError(text(outcome.failure));
    } finally {
      setPending(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    void set();
  }

  return (
    <Dialog
      isOpen
      title={t('account.setPasswordTitle', { username })}
      icon="key"
      onClose={() => onClose(false)}
    >
      <form data-testid="set-password" onSubmit={submit}>
        <DialogBody className="accounts-form">
          <p className="accounts-note">
            {t('account.setPasswordNote', { username })}
          </p>
          <PasswordPair
            id="set-password"
            next={next}
            repeat={repeat}
            onNext={setNext}
            onRepeat={setRepeat}
          />
          {error === null ? null : (
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
                text={t('confirm.cancel')}
                onClick={() => onClose(false)}
              />
              <Button
                type="submit"
                intent="primary"
                text={t('account.setPasswordSubmit')}
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
