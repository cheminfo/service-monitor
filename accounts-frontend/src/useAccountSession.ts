import { useSyncExternalStore } from 'react';

import type {
  AccountSessionState,
  AccountSessionStore,
} from './accountSession.ts';

/**
 * Where this browser stands, re-rendering whenever it changes.
 * @param store - the site's session
 * @returns the state
 */
export function useAccountSession(
  store: AccountSessionStore,
): AccountSessionState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
