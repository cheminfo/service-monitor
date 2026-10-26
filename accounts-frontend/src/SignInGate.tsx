import { Button, Callout, Spinner } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import { SignInForm } from './SignInForm.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import type { AccountRole } from './rules.ts';
import { roleAllows } from './rules.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the gate needs. */
export interface SignInGateProps {
  /** The site's session. */
  store: AccountSessionStore;
  /** The page behind the gate, drawn once signed in with the role. */
  children: ReactNode;
  /**
   * The role the page needs. An account below it is told so, with a way to
   * sign in as somebody else.
   * @default 'read'
   */
  role?: AccountRole;
  /**
   * What the sign-in form is headed with.
   * @default the chrome's own words for signing in, in the language of the page
   */
  title?: ReactNode;
  /**
   * What signing in gives access to, under the title.
   * @default undefined
   */
  note?: ReactNode;
}

/**
 * A page for the accounts: the page itself once this browser is signed in
 * with the role it needs, the sign-in form until then, and nothing at all
 * while the server has not said which — a form that turns into the page has
 * told the visitor something false. Asks the server the first time it is
 * drawn.
 * @param props - The session, the page, its role, and what the form says.
 * @returns The page, the form, a refusal, or a spinner.
 */
export function SignInGate(props: SignInGateProps) {
  const { store, children, role = 'read', title, note } = props;
  const { session } = useAccountSession(store);

  useEffect(() => {
    void store.ensureLoaded();
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
  if (!roleAllows(session.role, role)) {
    return (
      <RoleRefusal
        store={store}
        username={session.username ?? ''}
        needed={role}
      />
    );
  }
  return children;
}

/**
 * What an account below the role of a page sees: why, and the way to sign in
 * as an account that has it.
 * @param props - The session, who is signed in, and the role needed.
 * @param props.store - The site's session.
 * @param props.username - The account signed in.
 * @param props.needed - The role the page needs.
 * @returns The refusal.
 */
function RoleRefusal(props: {
  store: AccountSessionStore;
  username: string;
  needed: AccountRole;
}) {
  const { store, username, needed } = props;
  const t = useChromeT();

  return (
    <div className="accounts-sign-in">
      <div className="accounts-panel accounts-form" data-testid="role-refusal">
        <Callout intent="warning" compact role="alert">
          {t(needed === 'admin' ? 'account.needsAdmin' : 'account.needsWrite', {
            username,
          })}
        </Callout>
        <Button
          icon="log-out"
          text={t('account.switchAccount')}
          onClick={() => void store.signOut()}
        />
      </div>
    </div>
  );
}
