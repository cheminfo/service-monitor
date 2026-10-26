/** Luc, signed in to write. */
export const LUC = { signedIn: true, username: 'luc', role: 'write' };

/** Nobody signed in. */
export const NOBODY = { signedIn: false, username: null, role: null };

/** What a 401 of the session says. */
export const ENDED = {
  code: 'sessionEnded',
  status: 401,
  message: 'The session has ended: sign in again.',
};

/**
 * A server nothing reaches.
 * @returns a rejected request, as a fetch with no network answers
 */
export const unreachable: typeof fetch = () =>
  Promise.reject(new TypeError('fetch failed'));

/** One request the fake server was sent. */
export interface Asked {
  url: string;
  method: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
  cache: RequestCache | undefined;
}

/**
 * A server answering each route from a table, and remembering what it was
 * asked.
 * @param answers - the answer by `METHOD url`
 * @returns the fetch, and what it was asked
 */
export function fakeServer(answers: Record<string, () => Response>) {
  const asked: Asked[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    asked.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
      cache: init?.cache,
    });
    const answer = answers[`${method} ${url}`];
    return Promise.resolve(
      answer === undefined
        ? Response.json({ message: 'not found' }, { status: 404 })
        : answer(),
    );
  };
  return { fetcher, asked };
}

/**
 * A refusal as the accounts' routes write it.
 * @param status - the HTTP status
 * @param code - why, as a code
 * @param message - why, in English
 * @returns the response
 */
export function refusal(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { statusCode: status, error: 'Refused', message, code },
    { status },
  );
}
