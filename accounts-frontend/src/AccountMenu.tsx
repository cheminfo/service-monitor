import type { NavItem } from 'react-cheminfo/ui';
import { AccountButton, useChromeT } from 'react-cheminfo/ui';

import type { AccountSessionStore } from './accountSession.ts';
import { ROLE_LABEL_KEYS } from './roleLabels.ts';
import { useAccountSession } from './useAccountSession.ts';

/** What the account menu needs. */
export interface AccountMenuProps {
  /** The site's session. */
  store: AccountSessionStore;
  /**
   * The account's own pages, listed above Sign out for every account.
   * @default undefined
   */
  items?: readonly NavItem[];
  /**
   * The pages only an administrator opens — the Users page — listed after
   * `items` while the account signed in has the `admin` role.
   * @default undefined
   */
  adminItems?: readonly NavItem[];
  /**
   * Called once signed out, to leave a page that needs an account.
   * @default undefined
   */
  onSignedOut?: () => void;
}

/**
 * Who is signed in, at the extreme right of the bar: the account's initials,
 * opening a menu with its name, its role, its pages and Sign out. Nothing at
 * all while nobody is — signing in starts on the About — or while the server
 * has not said.
 * @param props - The session, and the account's pages.
 * @returns The entry, or nothing.
 */
export function AccountMenu(props: AccountMenuProps) {
  const { store, items = [], adminItems = [], onSignedOut } = props;
  const t = useChromeT();
  const { session } = useAccountSession(store);
  if (!session?.signedIn) return null;
  const { role, username } = session;

  return (
    <AccountButton
      identity={{
        name: username ?? '',
        detail: role === null ? undefined : t(ROLE_LABEL_KEYS[role]),
      }}
      items={role === 'admin' ? [...items, ...adminItems] : items}
      onSignOut={() =>
        void store.signOut().then(() => {
          onSignedOut?.();
        })
      }
    />
  );
}
