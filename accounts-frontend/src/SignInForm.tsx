import { Button } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import { SignInFields } from './SignInFields.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { useSignIn } from './useSignIn.ts';

/** What the sign-in form needs. */
export interface SignInFormProps {
  /** The site's session. */
  store: AccountSessionStore;
  /**
   * What the form is headed with.
   * @default the chrome's own words for signing in, in the language of the page
   */
  title?: ReactNode;
  /**
   * One line under the title: what signing in gives access to.
   * @default undefined
   */
  note?: ReactNode;
  /**
   * Called once signed in, to go where the visitor was heading.
   * @default undefined
   */
  onSignedIn?: () => void;
}

/**
 * Sign in with a username and a password, in a panel of the page. The cookie
 * the server answers with is the browser's: nothing is kept here.
 * @param props - The session, and what the form says.
 * @returns The form.
 */
export function SignInForm(props: SignInFormProps) {
  const { store, title, note, onSignedIn } = props;
  const t = useChromeT();
  const state = useSignIn(store, onSignedIn);

  return (
    <div className="accounts-sign-in">
      <form
        className="accounts-panel accounts-form"
        aria-labelledby="accounts-sign-in-title"
        data-testid="sign-in"
        onSubmit={state.submit}
      >
        <h1 id="accounts-sign-in-title">{title ?? t('account.signIn')}</h1>
        {note === undefined ? null : <p className="accounts-note">{note}</p>}
        <SignInFields state={state} />
        <Button
          type="submit"
          intent="primary"
          text={t('account.signIn')}
          fill
          loading={state.pending}
          disabled={!state.ready}
        />
      </form>
    </div>
  );
}
