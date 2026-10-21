import { join } from 'node:path';

/**
 * Where a service keeps its monitor store: `sqlite/monitor.sqlite` in its data
 * directory, beside the `sqlite/db.sqlite` every service keeps its own data
 * in. The same path in every project, so the logs of any of them are found,
 * backed up and browsed the same way.
 * @param dataDirectory - the service's data directory, `DATA_DIR`
 * @returns the path of the store's file
 */
export function monitorStorePath(dataDirectory: string): string {
  return join(dataDirectory, 'sqlite', 'monitor.sqlite');
}
