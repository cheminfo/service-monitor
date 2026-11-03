import type { FastifyReply, FastifyRequest } from 'fastify';

import { CHANGES, identify, refusalOf } from './credentials.ts';
import { refuse } from './refuse.ts';
import type { AccountRole } from './rules.ts';
import { roleAllows } from './rules.ts';
import type { SessionContext } from './sessionContext.ts';
import type { AccountRow } from './store/accountRows.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The account a protected request was let through for, by its session or
     * its API token, or null when the operator's token let it through.
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

/** Who a request is let through for. */
export interface SignedIn {
  /** The account signed in, or null when the operator's token was sent. */
  account: AccountRow | null;
  /** What it may do: `admin` for the operator's token. */
  role: AccountRole;
}

/**
 * The hook that lets the operator's token through, and the requests of an
 * account signed in or sending its API token whose role is high enough, and
 * refuses every other: 401 when nobody is signed in, 403 below the role. A
 * session changes nothing from another site's page.
 * @param context - the sessions and the tokens
 * @param role - the role every route of the scope needs at least
 * @param openReads - whether a request that changes nothing passes for
 * everybody
 * @returns the `onRequest` hook
 */
export function createGuard(
  context: SessionContext,
  role: AccountRole,
  openReads = false,
) {
  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    if (openReads && !CHANGES.has(request.method)) return undefined;
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
      refusalOf(identity.token, identity.session, context),
    );
  };
}

/**
 * Who a request comes from, refusing nobody: for a route open to everybody
 * that shows more to an account signed in or sending its API token, or to the
 * operator's token. A session asking for a change from another site's page
 * counts as nobody.
 * @param context - the sessions and the tokens
 * @param request - the request
 * @returns who, or null for nobody
 */
export async function signedInOf(
  context: SessionContext,
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
