import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifySchema,
  preHandlerHookHandler,
} from 'fastify';

import type { MonitorStatusOptions } from './health/status.ts';
import { readMonitorStatus } from './health/status.ts';
import { readHostMetrics } from './host/hostMetrics.ts';
import { LEVELS } from './levels.ts';
import type { MonitorStore } from './store/MonitorStore.ts';
import { MAX_LIMIT } from './store/logQuery.ts';
import type { LogRetention } from './store/retention.ts';
import type {
  LogFacetsResponse,
  LogLevel,
  LogsResponse,
  MonitorStatus,
  ProcessesResponse,
} from './types.ts';

const DEFAULT_PREFIX = '/v1/monitor';

/**
 * How long after the server is ready the lines are first pruned: past the
 * start, and before a server restarted more often than hourly never does.
 */
const FIRST_PRUNE_DELAY_MS = 60_000;

/**
 * A hook run before each route, as a route's own `preHandler` is: with a
 * `done` callback, or async.
 */
export type MonitorPreHandler = (
  ...args: Parameters<preHandlerHookHandler>
) => void | Promise<unknown>;

/**
 * The store, or what opens it.
 */
export type StoreSource =
  | MonitorStore
  | Promise<MonitorStore>
  | (() => MonitorStore | Promise<MonitorStore>);

/**
 * Options for `serviceMonitorPlugin`: the store, the host's authentication,
 * what `GET /status` expects, and how long the lines are kept.
 */
export interface ServiceMonitorPluginOptions extends MonitorStatusOptions {
  /**
   * The store the routes read; a function is called at every request.
   */
  store: StoreSource;
  /**
   * Run before every route, to require the host's authentication: the lines
   * name paths, processes and errors nobody else needs to read.
   * @default undefined
   */
  preHandler?: MonitorPreHandler;
  /**
   * How often the lines past their retention are deleted while the server
   * runs, in milliseconds, the first time a minute after it is ready; 0 never
   * deletes them, for a service another process of which does.
   * @default 3600000
   */
  pruneIntervalMs?: number;
  /**
   * How long the lines are kept.
   * @default a week below `warn`, at most a million of them; ninety days for the others
   */
  retention?: LogRetention;
}

interface LogsQuerystring {
  minLevel?: LogLevel;
  topic?: string[];
  role?: string[];
  q?: string;
  before?: number;
  after?: number;
  limit?: number;
}

/**
 * A Fastify plugin answering what the monitor store holds, read-only:
 *
 * - `GET /logs` — a page of lines, by level, topic, role and text;
 * - `GET /logs/facets` — the topics and roles that have logged;
 * - `GET /processes` — what every running process last reported;
 * - `GET /host` — the machine's processor, memory and data volume;
 * - `GET /status` — the health checks, the machine and the processes at once.
 *
 * Mounted under `/v1/monitor`, or under the `prefix` it is registered with.
 * While the server runs it also deletes, once an hour, the lines past their
 * retention.
 * @param fastify - the instance
 * @param options - the store, and the host's authentication
 */
export const serviceMonitorPlugin: FastifyPluginAsync<
  ServiceMonitorPluginOptions
> = async (fastify, options) => {
  const register = (instance: FastifyInstance) => {
    registerRoutes(instance, options);
  };
  // Registered without a prefix, the plugin's own is the root: mount the
  // routes under the default instead.
  if (fastify.prefix === '/' || fastify.prefix === '') {
    await fastify.register(
      async (instance) => {
        register(instance);
      },
      { prefix: DEFAULT_PREFIX },
    );
  } else {
    register(fastify);
  }
};

/**
 * Register the routes, and the pruning.
 * @param fastify - the instance, under its prefix
 * @param options - the plugin's options
 */
function registerRoutes(
  fastify: FastifyInstance,
  options: ServiceMonitorPluginOptions,
): void {
  const {
    preHandler,
    dataDirectory = process.cwd(),
    expectedRoles,
    mainRole,
    checks,
    pruneIntervalMs = 3_600_000,
    retention,
  } = options;
  const store = () =>
    Promise.resolve(
      typeof options.store === 'function' ? options.store() : options.store,
    );
  schedulePruning(fastify, store, pruneIntervalMs, retention);

  fastify.get<{ Querystring: LogsQuerystring }>(
    '/logs',
    {
      preHandler,
      schema: documented({
        summary: 'A page of what every process logged, the newest first',
        description:
          'Filtered by the least severe level, by topic and by role, any of which may repeat, and by text the message holds. `before` reads the next older page; `after` the lines written since, the oldest first. A text search reads the most recent lines only, and says so with `truncated`.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            minLevel: { type: 'string', enum: [...LEVELS] },
            topic: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            role: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            q: { type: 'string', maxLength: 200 },
            before: { type: 'integer', minimum: 1 },
            after: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
          },
        },
      }),
    },
    async (request): Promise<LogsResponse> => {
      const { minLevel, topic, role, q, before, after, limit } = request.query;
      const opened = await store();
      return opened.queryLogs({
        minLevel,
        topics: topic,
        roles: role,
        text: q?.trim(),
        before,
        after,
        limit,
      });
    },
  );

  fastify.get(
    '/logs/facets',
    {
      preHandler,
      schema: documented({ summary: 'The topics and roles that have logged' }),
    },
    async (): Promise<LogFacetsResponse> => {
      const opened = await store();
      return opened.logFacets();
    },
  );

  fastify.get(
    '/processes',
    {
      preHandler,
      schema: documented({
        summary: 'What every process of the service last reported',
      }),
    },
    async (): Promise<ProcessesResponse> => {
      const readAt = Date.now();
      const opened = await store();
      return { readAt, processes: opened.readProcesses(readAt) };
    },
  );

  fastify.get(
    '/host',
    {
      preHandler,
      schema: documented({
        summary: "The machine's processor, memory and data volume",
      }),
    },
    () => readHostMetrics(dataDirectory),
  );

  fastify.get(
    '/status',
    {
      preHandler,
      schema: documented({
        summary:
          'The health checks, the machine and every process, read at one instant',
        description:
          'Everything a monitor page shows but the lines: whether the data volume and the memory hold, whether every process reports and every expected role runs, and the errors of the last hour, judged the worst first. The processor share is measured since the previous reading of `/status` or `/host`, so a page reads one of the two.',
      }),
    },
    async (): Promise<MonitorStatus> =>
      readMonitorStatus(await store(), {
        dataDirectory,
        expectedRoles,
        mainRole,
        checks,
      }),
  );
}

/**
 * Delete the lines past their retention once an hour while the server runs,
 * the first time a minute after it is ready. A pass still running when the
 * next is due is not doubled, and closing the server waits for it.
 * @param fastify - the instance
 * @param store - opens the store
 * @param intervalMs - how often; 0 never
 * @param retention - how long the lines are kept
 */
function schedulePruning(
  fastify: FastifyInstance,
  store: () => Promise<MonitorStore>,
  intervalMs: number,
  retention: LogRetention | undefined,
): void {
  if (!(intervalMs > 0)) return;
  let first: NodeJS.Timeout | undefined;
  let every: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const prune = () => {
    running ??= (async () => {
      try {
        const opened = await store();
        const deleted = await opened.prune(Date.now(), retention);
        if (deleted > 0) {
          fastify.log.info(`${deleted} log lines past their retention deleted`);
        }
      } catch (error: unknown) {
        fastify.log.warn({ err: error }, 'the log lines were not pruned');
      }
    })().finally(() => {
      running = undefined;
    });
  };

  fastify.addHook('onReady', async () => {
    first = setTimeout(
      () => {
        prune();
        every = setInterval(prune, intervalMs).unref();
      },
      Math.min(FIRST_PRUNE_DELAY_MS, intervalMs),
    ).unref();
  });
  fastify.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(every);
    await running;
  });
}

/**
 * A route's schema, with what the API documentation says of it. The keys are
 * \@fastify/swagger's, which Fastify keeps and ignores when it is absent.
 * @param schema - the summary, the description and the validation
 * @param schema.summary - one line
 * @param schema.description - more, when the summary is not enough
 * @returns the schema
 */
function documented(
  schema: { summary: string; description?: string } & FastifySchema,
): FastifySchema {
  return { tags: ['monitor'], ...schema } as FastifySchema;
}
