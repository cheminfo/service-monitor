import { Spinner } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { SignInForm } from './SignInForm.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the gate needs. */
export interface SignInGateProps {
  /** The site's session. */
  store: AccountSessionStore;
  /** The operator's page, drawn once signed in. */
  children: ReactNode;
  /**
   * What the sign-in form is headed with.
   * @default 'Sign in'
   */
  title?: ReactNode;
  /**
   * What signing in gives access to, under the title.
   * @default undefined
   */
  note?: ReactNode;
}

/**
 * An operator's page: the page itself once this browser is signed in, the
 * sign-in form until then, and nothing at all while the server has not said
 * which — a form that turns into the page has told the visitor something
 * false. Asks the server the first time it is drawn.
 * @param props - The session, the page, and what the form says.
 * @returns The page, the form, or a spinner.
 */
export function SignInGate(props: SignInGateProps) {
  const { store, children, title, note } = props;
  const { session } = useAccountSession(store);

  useEffect(() => {
    if (store.get().session === null) void store.load();
  }, [store]);

  if (session === null) {
    return (
      <div className="accounts-sign-in" aria-busy="true">
        <Spinner size={24} />
      </div>
    );
  }
  if (!session.signedIn) {
    return <SignInForm store={store} title={title} note={note} />;
  }
  return children;
}
