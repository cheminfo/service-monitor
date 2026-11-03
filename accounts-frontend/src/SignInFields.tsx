import { Callout, FormGroup, InputGroup } from '@blueprintjs/core';
import { useId } from 'react';
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
  // The form of a page and the dialog of the header may both be open: each
  // label must name the field beside it, not the first of that id.
  const id = useId();

  return (
    <>
      <FormGroup label={t('account.username')} labelFor={`${id}-username`}>
        <InputGroup
          id={`${id}-username`}
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          autoFocus={autoFocus}
          spellCheck={false}
          value={state.username}
          onValueChange={state.setUsername}
        />
      </FormGroup>
      <FormGroup label={t('account.password')} labelFor={`${id}-password`}>
        <InputGroup
          id={`${id}-password`}
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
