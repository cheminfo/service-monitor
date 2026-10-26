import { Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import { useChromeT } from 'react-cheminfo/ui';

import type { SignInState } from './useSignIn.ts';

/**
 * The username and the password of a sign-in, and why it was refused: the
 * inside of the form and of the dialog alike.
 * @param props - The state of the sign-in.
 * @param props.state - What the fields read and write.
 * @param props.autoFocus - Whether the username takes the focus; false when
 * left out.
 * @returns The fields.
 */
export function SignInFields(props: {
  state: SignInState;
  autoFocus?: boolean;
}) {
  const { state, autoFocus = false } = props;
  const t = useChromeT();

  return (
    <>
      <FormGroup label={t('account.username')} labelFor="accounts-username">
        <InputGroup
          id="accounts-username"
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          autoFocus={autoFocus}
          spellCheck={false}
          value={state.username}
          onValueChange={state.setUsername}
        />
      </FormGroup>
      <FormGroup label={t('account.password')} labelFor="accounts-password">
        <InputGroup
          id="accounts-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={state.password}
          onValueChange={state.setPassword}
        />
      </FormGroup>
      {state.error === null ? null : (
        <Callout intent="danger" compact role="alert">
          {state.error}
        </Callout>
      )}
    </>
  );
}
