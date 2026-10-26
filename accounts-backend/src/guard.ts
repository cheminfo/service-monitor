import { fastifyCookie } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { isSameOrigin } from './isSameOrigin.ts';
import { refuse } from './refuse.ts';
import type { AccountRefusal, AccountRole } from './rules.ts';
import { roleAllows } from './rules.ts';
import { sameSecret } from './sameSecret.ts';
import type { Sessions } from './sessions.ts';
import type { AccountRow, AccountStore } from './store/AccountStore.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The account a protected request was let through for, or null when the
     * operator's token let it through.
     */
    signedInAccount: AccountRow | null;
  }

  interface FastifyContextConfig {
    /**
     * The role a route of a protected scope needs, when it needs more than
     * the scope: `config: { accountRole: 'write' }`. It never lowers the
     * scope's own.
     * @default the role the scope was protected with
     */
    accountRole?: AccountRole;
  }
}

/** The methods that change something. */
const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** What the guard and the routes share. */
export interface AccountsContext {
  /** The accounts. */
  store: () => Promise<AccountStore>;
  /** What opens and checks sessions. */
  sessions: Sessions;
  /** The cookie a session is kept in. */
  cookieName: string;
  /** The operator's token, or undefined when none is taken. */
  adminToken: string | undefined;
}

/** Who a request is let through for. */
export interface SignedIn {
  /** The account signed in, or null when the operator's token was sent. */
  account: AccountRow | null;
  /** What it may do: `admin` for the operator's token. */
  role: AccountRole;
}

/**
 * The hook that lets the operator's token through, and the requests of an
 * account signed in whose role is high enough, and refuses every other: 401
 * when nobody is signed in, 403 below the role. A session changes nothing
 * from another site's page.
 * @param context - the accounts, the sessions and the operator's token
 * @param role - the role every route of the scope needs at least
 * @returns the `onRequest` hook
 */
export function createGuard(context: AccountsContext, role: AccountRole) {
  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    const needed = strongerRole(role, request.routeOptions.config.accountRole);
    const identity = await identify(context, request);
    if (identity.status === 'token') {
      request.signedInAccount = null;
      return undefined;
    }
    if (identity.status === 'account') {
      const { account } = identity;
      if (roleAllows(account.role, needed)) {
        request.signedInAccount = account;
        return undefined;
      }
      request.log.warn(
        { clientIp: request.ip, username: account.username, needed },
        'refused an account whose role is too low',
      );
      return refuse(reply, 403, 'roleTooLow');
    }
    if (identity.status === 'elsewhere') {
      request.log.warn(
        { clientIp: request.ip, origin: request.headers.origin },
        'refused a change asked from another site',
      );
      return refuse(reply, 403, 'changeElsewhere');
    }
    request.log.warn({ clientIp: request.ip }, 'refused a request signed out');
    return refuse(
      reply.header('www-authenticate', 'Bearer'),
      401,
      refusalOf(identity.token, identity.session, context.adminToken),
    );
  };
}

/**
 * Who a request comes from, refusing nobody: for a route open to everybody
 * that shows more to an account signed in, or to the operator's token. A
 * session asking for a change from another site's page counts as nobody.
 * @param context - the accounts, the sessions and the operator's token
 * @param request - the request
 * @returns who, or null for nobody
 */
export async function signedInOf(
  context: AccountsContext,
  request: FastifyRequest,
): Promise<SignedIn | null> {
  const identity = await identify(context, request);
  if (identity.status === 'token') return { account: null, role: 'admin' };
  if (identity.status === 'account') {
    return { account: identity.account, role: identity.account.role };
  }
  return null;
}

/**
 * The session cookie a request carries, whether or not a cookie parser runs
 * in the scope it is answered in.
 * @param request - the request
 * @param cookieName - the cookie a session is kept in
 * @returns the cookie's value, or undefined
 */
export function sessionCookie(
  request: FastifyRequest,
  cookieName: string,
): string | undefined {
  const parsed = (request as { cookies?: Record<string, string | undefined> })
    .cookies;
  if (parsed !== undefined) return parsed[cookieName];
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  return fastifyCookie.parse(header)[cookieName];
}

/**
 * The higher of two roles, for a route asking more than the scope it is in.
 * @param floor - the role the whole scope needs
 * @param asked - the role one route asks for, if any
 * @returns `asked` when it is higher, else `floor`
 */
export function strongerRole(
  floor: AccountRole,
  asked: AccountRole | undefined,
): AccountRole {
  return asked !== undefined && !roleAllows(floor, asked) ? asked : floor;
}

/** What a request's credentials say, before anything is decided on them. */
type Identity =
  | { status: 'token' }
  | { status: 'account'; account: AccountRow }
  | { status: 'elsewhere' }
  | {
      status: 'nobody';
      token: string | undefined;
      session: string | undefined;
    };

/**
 * Read a request's credentials: the operator's token, or a session that is
 * still valid. A valid session asking for a change from another site's page
 * is `elsewhere`: the cookie is never sent from another site, and a browser
 * names the page a change comes from, so refusing it is the second lock on
 * the same door.
 * @param context - the accounts, the sessions and the operator's token
 * @param request - the request
 * @returns what they say
 */
async function identify(
  context: AccountsContext,
  request: FastifyRequest,
): Promise<Identity> {
  const { sessions, cookieName, adminToken } = context;
  const token = bearerToken(request);
  if (
    adminToken !== undefined &&
    adminToken !== '' &&
    token !== undefined &&
    (await sameSecret(adminToken, token))
  ) {
    return { status: 'token' };
  }

  const session = sessionCookie(request, cookieName);
  if (token === undefined && session !== undefined) {
    const store = await context.store();
    const verified = await sessions.verify(session, (id) => store.byId(id));
    if (verified !== null) {
      if (!CHANGES.has(request.method) || isSameOrigin(request)) {
        return { status: 'account', account: verified.account };
      }
      return { status: 'elsewhere' };
    }
  }
  return { status: 'nobody', token, session };
}

/**
 * Why a request nobody signed in made was refused, as what to do about it.
 * @param token - the bearer token it sent, if any
 * @param session - the session cookie it sent, if any
 * @param adminToken - the operator's token, or undefined when none is set
 * @returns the refusal
 */
function refusalOf(
  token: string | undefined,
  session: string | undefined,
  adminToken: string | undefined,
): AccountRefusal {
  if (token !== undefined) {
    return adminToken === undefined || adminToken === ''
      ? 'noAdminToken'
      : 'wrongToken';
  }
  if (session !== undefined) return 'sessionEnded';
  return 'signInRequired';
}

/**
 * The token of an `Authorization: Bearer` header.
 * @param request - the request
 * @returns the token, or undefined without one
 */
function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  return /^Bearer\s+(?<token>\S+)\s*$/i.exec(header)?.groups?.token;
}
