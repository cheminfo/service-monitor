import type { FastifyRequest } from 'fastify';

/**
 * Whether a request comes from a page of this site, or from no page at all.
 *
 * A browser names the page's origin on every POST, PATCH and DELETE; a script
 * usually sends none, and is bounded by whatever else guards the route.
 * @param request - the request
 * @returns false for a page served by another site
 */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.host;
  } catch {
    return false;
  }
}
