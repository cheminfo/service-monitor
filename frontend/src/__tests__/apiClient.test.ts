import { expect, test } from 'vitest';

import { createMonitorClient, logsSearch } from '../apiClient.ts';

const FILTERS = { minLevel: 'trace', topics: [], roles: [], text: '' } as const;

test('a filter left at its default is not written', () => {
  expect(logsSearch(FILTERS)).toBe('');
});

test('topics and roles repeat, the text is trimmed, and the page follows', () => {
  expect(
    logsSearch(
      {
        minLevel: 'warn',
        topics: ['http', 'writeQueue'],
        roles: ['import'],
        text: '  disk full ',
      },
      { before: 120, limit: 50 },
    ),
  ).toBe(
    'minLevel=warn&topic=http&topic=writeQueue&role=import&q=disk+full&before=120&limit=50',
  );
});

test('the client reads under its base path, and a refusal says why', async () => {
  const asked: string[] = [];
  const client = createMonitorClient('/v1/admin/monitor', (input) => {
    const url = typeof input === 'string' ? input : 'not a string';
    asked.push(url);
    return Promise.resolve(
      url.endsWith('/host')
        ? Response.json({ message: 'Sign in first' }, { status: 401 })
        : Response.json({ topics: [], roles: [] }),
    );
  });

  await expect(client.facets()).resolves.toStrictEqual({
    topics: [],
    roles: [],
  });
  await expect(client.host()).rejects.toThrow(
    '/v1/admin/monitor/host answered 401: Sign in first',
  );
  expect(asked).toStrictEqual([
    '/v1/admin/monitor/logs/facets',
    '/v1/admin/monitor/host',
  ]);
});

test('the status is read under the base path', async () => {
  const asked: string[] = [];
  const client = createMonitorClient('/v1/admin/monitor', (input) => {
    asked.push(typeof input === 'string' ? input : 'not a string');
    return Promise.resolve(
      Response.json({ readAt: 5, checks: [], host: null, processes: [] }),
    );
  });

  await expect(client.status()).resolves.toStrictEqual({
    readAt: 5,
    checks: [],
    host: null,
    processes: [],
  });
  expect(asked).toStrictEqual(['/v1/admin/monitor/status']);
});

test('a refusal says its error when it has no message, and its status text when it says neither', async () => {
  const client = createMonitorClient('/v1/monitor', (input) => {
    if (input === '/v1/monitor/processes') {
      return Promise.resolve(
        Response.json({ error: 'Forbidden' }, { status: 403 }),
      );
    }
    if (input === '/v1/monitor/status') {
      return Promise.resolve(
        Response.json({}, { status: 404, statusText: 'Not Found' }),
      );
    }
    return Promise.resolve(
      new Response('<h1>Bad gateway</h1>', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );
  });

  await expect(client.processes()).rejects.toThrow(
    '/v1/monitor/processes answered 403: Forbidden',
  );
  await expect(client.status()).rejects.toThrow(
    '/v1/monitor/status answered 404: Not Found',
  );
  await expect(client.host()).rejects.toThrow(
    '/v1/monitor/host answered 502: Bad Gateway',
  );
});
