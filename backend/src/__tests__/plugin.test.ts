import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import Fastify from 'fastify';
import { expect, onTestFinished, test, vi } from 'vitest';

import type { ServiceMonitorPluginOptions } from '../plugin.ts';
import { serviceMonitorPlugin } from '../plugin.ts';
import type { MonitorStore } from '../store/MonitorStore.ts';
import type { MonitorStatus, ProcessStatus } from '../types.ts';

import { logRow, openStore } from './fixtures.ts';

const DAY = 24 * 3600 * 1000;

/**
 * A ready instance serving the plugin, closed when the calling test finishes.
 * @param store - the store it reads
 * @param options - the other options, and the prefix
 * @param options.prefix - where it is mounted; the plugin's default when absent
 * @returns the instance
 */
async function serve(
  store: MonitorStore,
  options: Partial<ServiceMonitorPluginOptions> & { prefix?: string } = {},
) {
  const fastify = Fastify();
  onTestFinished(() => fastify.close());
  await fastify.register(serviceMonitorPlugin, {
    store: () => store,
    dataDirectory: tmpdir(),
    ...options,
  });
  await fastify.ready();
  return fastify;
}

test('the lines are read by level, by repeated topics and by text', async () => {
  const store = await openStore();
  store.insertLogs([
    logRow({ topic: 'http', message: 'GET /' }),
    logRow({ level: 40, topic: 'writeQueue', message: 'busy' }),
    logRow({ level: 50, topic: 'import', message: 'disk full' }),
  ]);
  const fastify = await serve(store);
  const messages = async (query: string) => {
    const response = await fastify.inject(`/v1/monitor/logs?${query}`);

    expect(response.statusCode).toBe(200);

    return response
      .json<{ logs: Array<{ message: string }> }>()
      .logs.map((line) => line.message);
  };

  await expect(messages('minLevel=warn')).resolves.toStrictEqual([
    'disk full',
    'busy',
  ]);
  await expect(messages('topic=http&topic=import')).resolves.toStrictEqual([
    'disk full',
    'GET /',
  ]);
  await expect(messages('topic=writeQueue')).resolves.toStrictEqual(['busy']);
  await expect(messages('q=DISK')).resolves.toStrictEqual(['disk full']);
  await expect(messages('limit=1&before=3')).resolves.toStrictEqual(['busy']);
});

test('a level the store does not know, or a page too long, is refused', async () => {
  const fastify = await serve(await openStore());

  const levels = await fastify.inject('/v1/monitor/logs?minLevel=loud');
  const limit = await fastify.inject('/v1/monitor/logs?limit=5000');

  expect([levels.statusCode, limit.statusCode]).toStrictEqual([400, 400]);
});

test('the facets, the processes and the machine are answered', async () => {
  const store = await openStore();
  store.insertLogs([logRow({ at: 5, topic: 'http' })]);
  const now = Date.now();
  store.writeProcess({
    role: 'server',
    pid: 7,
    hostname: 'host',
    startedAt: now - 1000,
    updatedAt: now,
    intervalMs: 10_000,
    memory: { rss: 3, heapUsed: 1, heapTotal: 2 },
    cpuPercent: 0,
    eventLoopDelayMs: 1,
    activity: {},
  });
  const fastify = await serve(store, { prefix: '/admin/monitor' });

  const facets = await fastify.inject('/admin/monitor/logs/facets');
  const processes = await fastify.inject('/admin/monitor/processes');
  const host = await fastify.inject('/admin/monitor/host');

  expect(facets.json()).toStrictEqual({
    topics: [{ name: 'http', lastAt: 5 }],
    roles: [{ name: 'server', lastAt: 5 }],
  });
  expect(
    processes.json<{ processes: Array<{ role: string; stale: boolean }> }>()
      .processes,
  ).toStrictEqual([expect.objectContaining({ role: 'server', stale: false })]);
  expect(host.json()).toMatchObject({
    cpu: { cores: expect.any(Number) },
    disk: { total: expect.any(Number), available: expect.any(Number) },
  });
});

test("the host's pre-handler guards every route", async () => {
  const fastify = await serve(await openStore(), {
    preHandler: (_request, reply) => {
      void reply.code(401).send({ error: 'Sign in' });
    },
  });

  const statuses = await Promise.all(
    ['/logs', '/logs/facets', '/processes', '/host', '/status'].map(
      async (path) => {
        const response = await fastify.inject(`/v1/monitor${path}`);
        return response.statusCode;
      },
    ),
  );

  expect(statuses).toStrictEqual([401, 401, 401, 401, 401]);
});

test('the status judges the processes, the roles expected and the errors of the hour, with the host own checks', async () => {
  const store = await openStore();
  const now = Date.now();
  store.writeProcess(processStatus({ role: 'server', updatedAt: now }));
  store.insertLogs([logRow({ at: now, level: 50, message: 'disk full' })]);
  const fastify = await serve(store, {
    expectedRoles: { scheduler: 'no source is imported again' },
    checks: ({ processes }) => [
      {
        id: 'sources',
        level: 'info',
        message: `${processes.length} process imports nothing yet.`,
      },
    ],
  });

  const response = await fastify.inject('/v1/monitor/status');
  const status = response.json<MonitorStatus>();

  expect(status.readAt).toBeGreaterThanOrEqual(now);
  expect(status.processes.map((view) => view.role)).toStrictEqual(['server']);
  expect(status.host.disk.total).toBeGreaterThan(0);
  expect(
    status.checks
      .filter((check) => check.id !== 'disk' && check.id !== 'memory')
      .map(({ id, level, message }) => [id, level, message]),
  ).toStrictEqual([
    [
      'service-scheduler',
      'warning',
      'No scheduler service is reporting: start it, or no source is imported again.',
    ],
    [
      'log-errors',
      'warning',
      '1 error was logged in the last hour: read them under Logs.',
    ],
    ['sources', 'info', '1 process imports nothing yet.'],
  ]);
});

test('a host check that throws is reported, and the others still are', async () => {
  const fastify = await serve(await openStore(), {
    checks: () => {
      throw new Error('the database is locked');
    },
  });

  const response = await fastify.inject('/v1/monitor/status');

  expect(
    response
      .json<MonitorStatus>()
      .checks.filter((check) => check.id === 'checks' || check.id === 'disk')
      .map(({ id, level, message }) => [id, level, message.slice(0, 50)]),
  ).toStrictEqual([
    ['checks', 'error', "The service's own checks failed: the database is l"],
    ['disk', expect.any(String), expect.any(String)],
  ]);
});

test('the lines past their retention are deleted while the server runs, and not after it closed', async () => {
  const store = await openStore();
  const now = Date.now();
  store.insertLogs([
    logRow({ at: now - 8 * DAY, message: 'last week' }),
    logRow({ at: now, message: 'today' }),
  ]);
  const prune = vi.spyOn(store, 'prune');
  const fastify = await serve(store, { pruneIntervalMs: 20 });

  await vi.waitFor(() => {
    expect(store.queryLogs({}).logs.map((line) => line.message)).toStrictEqual([
      'today',
    ]);
  });
  await vi.waitFor(() => {
    expect(prune.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  await fastify.close();
  const calls = prune.mock.calls.length;
  await setTimeout(60);

  expect(prune).toHaveBeenCalledTimes(calls);
});

test('no line is deleted when another process prunes', async () => {
  const store = await openStore();
  const prune = vi.spyOn(store, 'prune');
  await serve(store, { pruneIntervalMs: 0 });
  await setTimeout(40);

  expect(prune).not.toHaveBeenCalled();
});

/**
 * What a process reports, as given.
 * @param status - what differs from a server that just reported
 * @returns the status
 */
function processStatus(status: Partial<ProcessStatus> = {}): ProcessStatus {
  const now = Date.now();
  return {
    role: 'server',
    pid: 7,
    hostname: 'host',
    startedAt: now - 1000,
    updatedAt: now,
    intervalMs: 10_000,
    memory: { rss: 3, heapUsed: 1, heapTotal: 2 },
    cpuPercent: 0,
    eventLoopDelayMs: 1,
    activity: {},
    ...status,
  };
}

test('an async pre-handler guards the routes as a callback one does', async () => {
  const fastify = await serve(await openStore(), {
    preHandler: async (request, reply) => {
      if (request.headers.authorization !== 'Bearer operator') {
        await reply.code(401).send({ error: 'Sign in' });
      }
    },
  });

  const refused = await fastify.inject('/v1/monitor/status');
  const allowed = await fastify.inject({
    url: '/v1/monitor/logs',
    headers: { authorization: 'Bearer operator' },
  });

  expect([refused.statusCode, allowed.statusCode]).toStrictEqual([401, 200]);
});
