import type { NavItem } from 'react-cheminfo/ui';
import { AccountButton } from 'react-cheminfo/ui';

import type { AccountSessionStore } from './accountSession.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the account menu needs. */
export interface AccountMenuProps {
  /** The site's session. */
  store: AccountSessionStore;
  /**
   * The account's own pages, listed above Sign out — the Accounts page.
   * @default undefined
   */
  items?: readonly NavItem[];
  /**
   * Called once signed out, to leave an operator's page.
   * @default undefined
   */
  onSignedOut?: () => void;
}

/**
 * Who is signed in, at the extreme right of the bar: the account's initials,
 * opening its menu. Nothing at all while nobody is — signing in starts on the
 * About — or while the server has not said.
 * @param props - The session, and the account's pages.
 * @returns The entry, or nothing.
 */
export function AccountMenu(props: AccountMenuProps) {
  const { store, items, onSignedOut } = props;
  const { session } = useAccountSession(store);
  if (!session?.signedIn) return null;

  return (
    <AccountButton
      identity={{ name: session.username ?? '' }}
      items={items}
      onSignOut={() =>
        void store.signOut().then(() => {
          onSignedOut?.();
        })
      }
    />
  );
}
