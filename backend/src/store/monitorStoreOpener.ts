import type { MonitorStoreOptions } from './MonitorStore.ts';
import { MonitorStore } from './MonitorStore.ts';

/**
 * Open a store on first use, once per process: every caller shares the one
 * opening, and an opening that failed is tried again at the next call. Hand
 * the function to the plugin, and what it returns to the heartbeat.
 * @param path - the file, `monitorStorePath(DATA_DIR)`
 * @param options - how it reads
 * @returns what opens the store, or answers the store already open
 */
export function monitorStoreOpener(
  path: string,
  options?: MonitorStoreOptions,
): () => Promise<MonitorStore> {
  let opening: Promise<MonitorStore> | undefined;
  return () => {
    if (opening === undefined) {
      const attempt = MonitorStore.open(path, options);
      opening = attempt;
      attempt.catch(() => {
        if (opening === attempt) opening = undefined;
      });
    }
    return opening;
  };
}
