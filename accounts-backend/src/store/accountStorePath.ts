import { join } from 'node:path';

/**
 * Where a service keeps its accounts: `sqlite/accounts.sqlite` in its data
 * directory, beside the `sqlite/db.sqlite` of its own data and the
 * `sqlite/monitor.sqlite` of its logs. The same path in every project, so the
 * accounts of any of them are found and backed up the same way.
 * @param dataDirectory - the service's data directory, `DATA_DIR`
 * @returns the path of the store's file
 */
export function accountStorePath(dataDirectory: string): string {
  return join(dataDirectory, 'sqlite', 'accounts.sqlite');
}
