import { expect, test } from 'vitest';

import { parseLogLine } from '../logs/parseLogLine.ts';

const NOW = 1_790_000_000_000;

test("a line's topic is its logger's name, and its other fields are kept", () => {
  expect(
    parseLogLine(
      '{"level":40,"time":1790000000123,"pid":7,"hostname":"h","name":"writeQueue","msg":"the writer is busy","waiting":12}\n',
      'main',
      NOW,
    ),
  ).toStrictEqual({
    at: 1_790_000_000_123,
    level: 40,
    topic: 'writeQueue',
    pid: 7,
    hostname: 'h',
    message: 'the writer is busy',
    meta: '{"waiting":12}',
  });
});

test('a request line is `http`, and says what was asked and answered', () => {
  const incoming = parseLogLine(
    '{"level":30,"time":1,"pid":7,"hostname":"h","reqId":"req-1","req":{"method":"GET","url":"/v1/search?q=1"},"msg":"incoming request"}',
    'main',
    NOW,
  );
  const completed = parseLogLine(
    '{"level":30,"time":2,"name":"server","reqId":"req-1","res":{"statusCode":200},"responseTime":12.4,"msg":"request completed"}',
    'main',
    NOW,
  );

  expect([incoming?.topic, incoming?.message]).toStrictEqual([
    'http',
    'incoming request GET /v1/search?q=1',
  ]);
  expect([completed?.topic, completed?.message, completed?.meta]).toStrictEqual(
    [
      'http',
      'request completed 200 12 ms',
      '{"reqId":"req-1","res":{"statusCode":200},"responseTime":12.4}',
    ],
  );
});

test("an error's message is added to the line's, and its stack kept", () => {
  const line = parseLogLine(
    JSON.stringify({
      level: 50,
      time: 1,
      name: 'import',
      msg: 'the batch failed',
      err: {
        type: 'Error',
        message: 'disk I/O error',
        stack: 'Error: disk I/O error\n    at write',
      },
    }),
    'main',
    NOW,
  );

  expect(line?.message).toBe('the batch failed disk I/O error');
  expect(JSON.parse(line?.meta ?? 'null')).toStrictEqual({
    err: {
      type: 'Error',
      message: 'disk I/O error',
      stack: 'Error: disk I/O error\n    at write',
    },
  });
});

test('an error logged alone is its own message', () => {
  const line = parseLogLine(
    '{"level":50,"time":1,"msg":"disk I/O error","err":{"message":"disk I/O error"}}',
    'main',
    NOW,
  );

  expect(line?.message).toBe('disk I/O error');
});

test('a line that is not JSON is kept as written, and a blank one is not', () => {
  expect(parseLogLine('plain text\n', 'main', NOW)).toStrictEqual({
    at: NOW,
    level: 30,
    topic: 'main',
    pid: undefined,
    hostname: undefined,
    message: 'plain text',
    meta: null,
  });
  expect(parseLogLine('[1, 2]', 'main', NOW)?.message).toBe('[1, 2]');
  expect(parseLogLine('  \n', 'main', NOW)).toBeUndefined();
});
