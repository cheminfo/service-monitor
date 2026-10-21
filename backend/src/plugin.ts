import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifySchema,
  preHandlerHookHandler,
} from 'fastify';

import { readHostMetrics } from './host/hostMetrics.ts';
import { LEVELS } from './levels.ts';
import type { MonitorStore } from './store/MonitorStore.ts';
import { MAX_LIMIT } from './store/logQuery.ts';
import type {
  LogFacetsResponse,
  LogLevel,
  LogsResponse,
  ProcessesResponse,
} from './types.ts';

const DEFAULT_PREFIX = '/v1/monitor';

/**
 * The store, or what opens it.
 */
export type StoreSource =
  | MonitorStore
  | Promise<MonitorStore>
  | (() => MonitorStore | Promise<MonitorStore>);

/**
 * Options for `serviceMonitorPlugin`.
 */
export interface ServiceMonitorPluginOptions {
  /**
   * The store the routes read; a function is called at every request.
   */
  store: StoreSource;
  /**
   * A path on the volume whose free space `GET /host` reports.
   * @default process.cwd()
   */
  dataDirectory?: string;
  /**
   * Run before every route, to require the host's authentication: the lines
   * name paths, processes and errors nobody else needs to read.
   * @default undefined
   */
  preHandler?: preHandlerHookHandler;
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
 * - `GET /host` — the machine's processor, memory and data volume.
 *
 * Mounted under `/v1/monitor`, or under the `prefix` it is registered with.
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
 * Register the four routes.
 * @param fastify - the instance, under its prefix
 * @param options - the plugin's options
 */
function registerRoutes(
  fastify: FastifyInstance,
  options: ServiceMonitorPluginOptions,
): void {
  const { preHandler, dataDirectory = process.cwd() } = options;
  const store = () =>
    Promise.resolve(
      typeof options.store === 'function' ? options.store() : options.store,
    );

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
