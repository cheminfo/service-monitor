import { LEVEL_VALUES } from '../levels.ts';

/**
 * A line, decoded: what the store keeps of it but the process's role.
 */
export interface ParsedLine {
  at: number;
  level: number;
  topic: string;
  /**
   * The pid and hostname pino wrote; undefined when its bindings left them out.
   */
  pid: number | undefined;
  hostname: string | undefined;
  message: string;
  /**
   * The other fields, as JSON; null when there are none.
   */
  meta: string | null;
}

/**
 * The fields the store keeps in columns of their own.
 */
const OWN_COLUMNS = new Set([
  'level',
  'time',
  'pid',
  'hostname',
  'name',
  'msg',
]);

/**
 * Decode a line pino wrote. A line Fastify wrote for a request, which carries
 * a `reqId`, is `http`, so the requests are told apart from what the server
 * says of itself; any other line's topic is its logger's `name`. A line that
 * is not JSON is kept as written, at `info`.
 * @param text - the line
 * @param defaultTopic - the topic of a line whose logger has no name
 * @param now - the instant of a line that carries none, in unix milliseconds
 * @returns the line, or undefined when it is blank
 */
export function parseLogLine(
  text: string,
  defaultTopic: string,
  now: number,
): ParsedLine | undefined {
  const line = text.trim();
  if (line === '') return undefined;
  let entry: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return plainLine(line, defaultTopic, now);
    }
    entry = value as Record<string, unknown>;
  } catch {
    return plainLine(line, defaultTopic, now);
  }

  const meta: Record<string, unknown> = {};
  let hasMeta = false;
  for (const [key, value] of Object.entries(entry)) {
    if (OWN_COLUMNS.has(key)) continue;
    meta[key] = value;
    hasMeta = true;
  }

  return {
    at: typeof entry.time === 'number' ? entry.time : now,
    level: typeof entry.level === 'number' ? entry.level : LEVEL_VALUES.info,
    topic: topicOf(entry, defaultTopic),
    pid: typeof entry.pid === 'number' ? entry.pid : undefined,
    hostname: typeof entry.hostname === 'string' ? entry.hostname : undefined,
    message: messageOf(entry),
    meta: hasMeta ? JSON.stringify(meta) : null,
  };
}

/**
 * The topic of a decoded line.
 * @param entry - the line
 * @param defaultTopic - the topic of a line whose logger has no name
 * @returns the topic
 */
function topicOf(entry: Record<string, unknown>, defaultTopic: string) {
  if (entry.reqId !== undefined) return 'http';
  if (typeof entry.name === 'string' && entry.name !== '') return entry.name;
  return defaultTopic;
}

/**
 * The message of a decoded line, with what a request line says in its other
 * fields: the method and address asked for, the status and the time taken;
 * and the error's message when it adds to the line's.
 * @param entry - the line
 * @returns the message
 */
function messageOf(entry: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof entry.msg === 'string' && entry.msg !== '') parts.push(entry.msg);
  const request = entry.req as { method?: unknown; url?: unknown } | undefined;
  if (typeof request?.method === 'string') {
    parts.push(
      `${request.method} ${typeof request.url === 'string' ? request.url : ''}`,
    );
  }
  const response = entry.res as { statusCode?: unknown } | undefined;
  if (typeof response?.statusCode === 'number') {
    parts.push(String(response.statusCode));
  }
  if (typeof entry.responseTime === 'number') {
    parts.push(`${Math.round(entry.responseTime)} ms`);
  }
  const error = entry.err as { message?: unknown } | undefined;
  if (typeof error?.message === 'string' && error.message !== entry.msg) {
    parts.push(error.message);
  }
  return parts.join(' ');
}

/**
 * A line that is not JSON, kept as written.
 * @param line - the line
 * @param topic - its topic
 * @param now - when it was read, in unix milliseconds
 * @returns the line
 */
function plainLine(line: string, topic: string, now: number): ParsedLine {
  return {
    at: now,
    level: LEVEL_VALUES.info,
    topic,
    pid: undefined,
    hostname: undefined,
    message: line,
    meta: null,
  };
}
