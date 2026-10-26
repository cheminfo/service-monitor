import { Button, Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import type { SubmitEvent } from 'react';
import { useState } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import type { AccountFormProps } from './AddAccountForm.tsx';
import { PasswordPair } from './PasswordPair.tsx';
import { passwordProblem } from './rules.ts';
import { useAccountFailureText } from './useAccountFailureText.ts';

/**
 * Change the password of the account signed in, whatever its role, given the
 * current one and the new one twice. This browser stays signed in; every
 * other session of the account ends.
 * @param props - The session, and what to do once it changed.
 * @returns The form.
 */
export function ChangePasswordForm(props: AccountFormProps) {
  const { store, onChanged } = props;
  const t = useChromeT();
  const text = useAccountFailureText();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function change(): Promise<void> {
    setChanged(false);
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
        store.client.changeOwnPassword(current, next),
      );
      if (outcome.ok) {
        store.renew(outcome.value);
        setChanged(true);
        setCurrent('');
        setNext('');
        setRepeat('');
        onChanged?.();
      } else {
        setError(text(outcome.failure));
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    void change();
  }

  return (
    <form
      className="accounts-form"
      data-testid="change-password"
      onSubmit={submit}
    >
      <FormGroup
        label={t('account.currentPassword')}
        labelFor="current-password"
      >
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
      {error === null ? null : (
        <Callout intent="danger" compact role="alert">
          {error}
        </Callout>
      )}
      {changed ? (
        <Callout intent="success" compact>
          {t('account.passwordChanged')}
        </Callout>
      ) : null}
      <Button
        type="submit"
        icon="key"
        text={t('account.changePassword')}
        loading={pending}
        disabled={current === '' || next === '' || repeat === ''}
      />
    </form>
  );
}
