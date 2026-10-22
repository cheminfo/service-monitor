import { AccountStore } from './AccountStore.ts';

/**
 * Open a store on first use, once per process: every caller shares the one
 * opening, and an opening that failed is tried again at the next call. Hand
 * the function to `createServiceAccounts`.
 * @param path - the file, `accountStorePath(DATA_DIR)`
 * @returns what opens the store, or answers the store already open
 */
export function accountStoreOpener(path: string): () => Promise<AccountStore> {
  let opening: Promise<AccountStore> | undefined;
  return () => {
    if (opening === undefined) {
      const attempt = AccountStore.open(path);
      opening = attempt;
      attempt.catch(() => {
        if (opening === attempt) opening = undefined;
      });
    }
    return opening;
  };
}
