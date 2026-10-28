import type { FastifyPluginAsync } from 'fastify';

import { signedInOf } from './guard.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { accountSecuritySchemes } from './routes/schemas.ts';
import { sessionStateRoutes } from './routes/sessionRoutes.ts';
import {
  sharedPasswordChangeRoute,
  sharedPasswordSignInRoute,
} from './routes/sharedPasswordRoutes.ts';
import { DEFAULT_SIGN_IN_LIMIT } from './serviceAccountsTypes.ts';
import { createSessionSetup, protectScope } from './sessionSetup.ts';
import type {
  SharedPassword,
  SharedPasswordOptions,
} from './sharedPasswordTypes.ts';
import { checkAgainstNobody } from './signIn.ts';
import type { AccountRow } from './store/AccountStore.ts';

/**
 * One password a site's operators share, with no usernames and no store of
 * accounts: the sign-in of a site that has one operator, like a label printer
 * manager. The sessions, the guard, the operator's token and the routes are
 * those of `createServiceAccounts`, so a site moving to accounts changes this
 * call alone.
 *
 * ```ts
 * const access = await createSharedPassword({
 *   cookieName: 'zebra_session',
 *   purpose: 'zebra-label-printer-manager session',
 *   readPasswordHash: () => db.getPasswordHash.get()?.value,
 *   writePasswordHash: (hash) => db.upsertPasswordHash.run(hash),
 *   ...readAccountConfig(),
 * });
 * await fastify.register(access.routes, { prefix: '/v1/auth' });
 * await fastify.register((scope) => {
 *   access.protect(scope, { openReads: true });
 *   scope.post('/printers', …);
 * }, { prefix: '/v1' });
 * ```
 * @param options - where the hash is kept, the cookie, the key and the operator's token
 * @returns the routes, the guard and the rest
 * @throws {Error} When `production` and no `cookieSecret` is given, saying
 * how to set one.
 */
export async function createSharedPassword(
  options: SharedPasswordOptions,
): Promise<SharedPassword> {
  const {
    cookieName,
    signInLimit = DEFAULT_SIGN_IN_LIMIT,
    readPasswordHash,
    writePasswordHash,
    verifyLegacyHash,
  } = options;
  const setup = await createSessionSetup(options, async (id) => {
    if (id !== SHARED_ACCOUNT_ID) return undefined;
    const hash = await readPasswordHash();
    return hash === undefined ? undefined : sharedAccount(hash);
  });
  const { context } = setup;

  async function check(password: string): Promise<AccountRow | null> {
    const stored = await readPasswordHash();
    if (stored === undefined) {
      await checkAgainstNobody(password);
      return null;
    }
    if (await verifyPassword(password, stored)) return sharedAccount(stored);
    if (
      verifyLegacyHash === undefined ||
      stored.startsWith(PACKAGE_HASH_PREFIX) ||
      !(await verifyLegacyHash(password, stored))
    ) {
      return null;
    }
    const upgraded = await hashPassword(password);
    await writePasswordHash(upgraded);
    return sharedAccount(upgraded);
  }

  async function change(password: string): Promise<AccountRow> {
    const hash = await hashPassword(password);
    await writePasswordHash(hash);
    return sharedAccount(hash);
  }

  const protect: SharedPassword['protect'] = (scope, protectOptions = {}) => {
    protectScope(scope, context, 'admin', protectOptions.openReads ?? false);
  };

  const routes: FastifyPluginAsync = async (instance) => {
    await setup.prepare(instance);
    sessionStateRoutes(instance, context);
    sharedPasswordSignInRoute(instance, context, signInLimit, check);
    await instance.register(async (guarded) => {
      protect(guarded);
      sharedPasswordChangeRoute(guarded, context, check, change);
    });
  };

  return {
    routes,
    protect,
    signedIn: async (request) => (await signedInOf(context, request)) !== null,
    securitySchemes: accountSecuritySchemes(cookieName),
  };
}

/** The account id the shared password's sessions name; no stored account has it. */
const SHARED_ACCOUNT_ID = 0;

/** How a hash of the package's own format starts. */
const PACKAGE_HASH_PREFIX = 'pbkdf2$';

/**
 * The shared password, as the sessions and the guard read an account: an
 * administrator with no username, whose sessions end with its hash.
 * @param passwordHash - the hash kept by the host
 * @returns the account
 */
function sharedAccount(passwordHash: string): AccountRow {
  return {
    id: SHARED_ACCOUNT_ID,
    username: '',
    passwordHash,
    role: 'admin',
    envManaged: false,
    createdAt: 0,
    passwordChangedAt: 0,
    lastSignInAt: null,
  };
}
