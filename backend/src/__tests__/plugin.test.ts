import { tmpdir } from 'node:os';

import Fastify from 'fastify';
import { expect, onTestFinished, test } from 'vitest';

import type { ServiceMonitorPluginOptions } from '../plugin.ts';
import { serviceMonitorPlugin } from '../plugin.ts';
import type { MonitorStore } from '../store/MonitorStore.ts';

import { logRow, openStore } from './fixtures.ts';

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
    ['/logs', '/logs/facets', '/processes', '/host'].map(async (path) => {
      const response = await fastify.inject(`/v1/monitor${path}`);
      return response.statusCode;
    }),
  );

  expect(statuses).toStrictEqual([401, 401, 401, 401]);
});
