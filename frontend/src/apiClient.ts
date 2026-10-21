import type {
  HostMetrics,
  LogFacetsResponse,
  LogLevel,
  LogsResponse,
  ProcessesResponse,
} from './types.ts';

/**
 * Which lines a reader asks for.
 */
export interface LogFilters {
  /**
   * The least severe level shown.
   */
  minLevel: LogLevel;
  /**
   * Only these topics; every topic when empty.
   */
  topics: readonly string[];
  /**
   * Only the processes with these roles; every one when empty.
   */
  roles: readonly string[];
  /**
   * Text the message holds; any message when blank.
   */
  text: string;
}

/**
 * Where in the lines a page starts.
 */
export interface LogPage {
  /**
   * The lines older than this id.
   * @default undefined — from the newest
   */
  before?: number;
  /**
   * The lines newer than this id, the oldest first.
   * @default undefined
   */
  after?: number;
  /**
   * @default 200
   */
  limit?: number;
}

/**
 * A client for the routes of the `service-monitor-backend` plugin.
 * @param apiBasePath - where the plugin is mounted, e.g. `/v1/monitor`; no
 *   trailing slash
 * @param fetcher - the fetch to call, to carry the host's authentication
 * @returns a method per route
 */
export function createMonitorClient(
  apiBasePath: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
) {
  /**
   * Read one route.
   * @param path - the route, with its query
   * @returns what it answered
   */
  async function request<T>(path: string): Promise<T> {
    const response = await fetcher(`${apiBasePath}${path}`);
    if (!response.ok) {
      throw new Error(
        `${apiBasePath}${path} answered ${response.status}: ${await readErrorMessage(response)}`,
      );
    }
    return response.json() as Promise<T>;
  }

  return {
    logs: (filters: LogFilters, page: LogPage = {}) =>
      request<LogsResponse>(`/logs?${logsSearch(filters, page)}`),
    facets: () => request<LogFacetsResponse>('/logs/facets'),
    processes: () => request<ProcessesResponse>('/processes'),
    host: () => request<HostMetrics>('/host'),
  };
}

/**
 * A client of the monitor's routes.
 */
export type MonitorClient = ReturnType<typeof createMonitorClient>;

/**
 * The query of `GET /logs`: a topic or a role repeated for each, and nothing
 * written that is left at its default.
 * @param filters - which lines
 * @param page - where the page starts
 * @returns the query, without its `?`
 */
export function logsSearch(filters: LogFilters, page: LogPage = {}): string {
  const query = new URLSearchParams();
  if (filters.minLevel !== 'trace') query.set('minLevel', filters.minLevel);
  for (const topic of filters.topics) query.append('topic', topic);
  for (const role of filters.roles) query.append('role', role);
  const text = filters.text.trim();
  if (text !== '') query.set('q', text);
  if (page.before !== undefined) query.set('before', String(page.before));
  if (page.after !== undefined) query.set('after', String(page.after));
  if (page.limit !== undefined) query.set('limit', String(page.limit));
  return query.toString();
}

/**
 * What a failed response says went wrong.
 * @param response - the response
 * @returns its message, or its status text
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return body.message ?? body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
