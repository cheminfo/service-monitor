import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import type { AccountSecuritySchemes } from './routes/schemas.ts';
import type { SessionOptions } from './serviceAccountsTypes.ts';

/** What one shared password is signed in with. */
export interface SharedPasswordOptions extends SessionOptions {
  /**
   * The hash of the password, as `hashPassword` writes it, read wherever the
   * host keeps it: a row of its settings, say. Read again at every request,
   * so a new password ends every session at once.
   * @returns the hash, or undefined while none is set and nobody can sign in
   */
  readPasswordHash: () => string | undefined | Promise<string | undefined>;
  /**
   * Keep a new hash: after `POST /password`, and when a hash of an older
   * format is upgraded at a sign-in.
   * @param hash - the new hash
   */
  writePasswordHash: (hash: string) => void | Promise<void>;
  /**
   * Check a password against a hash in a format the host kept before it used
   * this package. When it matches, the password is hashed again in the
   * package's format and kept, so it is asked only once per hash.
   * @default undefined — only the package's own hashes verify
   */
  verifyLegacyHash?: (password: string, hash: string) => Promise<boolean>;
}

/** How a scope of the host's is guarded by the shared password. */
export interface SharedPasswordProtectOptions {
  /**
   * Whether a request that changes nothing (`GET`, `HEAD`, `OPTIONS`) passes
   * for everybody, so only the changes need the password.
   * @default false
   */
  openReads?: boolean;
}

/** One shared password: its routes, and the guard of the host's own. */
export interface SharedPassword {
  /**
   * `GET /session`, `POST /login`, `POST /logout`, open to everybody, and
   * `POST /password` behind the guard. Register it with the prefix the site
   * chooses: `/v1/auth`.
   */
  routes: FastifyPluginAsync;
  /**
   * Guard every route registered after it in a scope of the host's: 401 when
   * nobody is signed in, 403 to a change asked from another site's page, and
   * the two credentials named in the OpenAPI document.
   * @param scope - an encapsulated scope, so the routes beside it stay open
   * @param options - whether the reads stay open
   */
  protect: (
    scope: FastifyInstance,
    options?: SharedPasswordProtectOptions,
  ) => void;
  /**
   * Whether a request comes from somebody signed in, or with the operator's
   * token, refusing nobody. For a route open to everybody that shows more
   * once signed in, which should then answer `Cache-Control: private`.
   * @param request - the request
   * @returns true when it does
   */
  signedIn: (request: FastifyRequest) => Promise<boolean>;
  /** The security schemes, for `components.securitySchemes` of the host. */
  securitySchemes: AccountSecuritySchemes;
}
