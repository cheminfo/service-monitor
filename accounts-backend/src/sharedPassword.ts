// `service-accounts-backend/shared-password`: one password a site's operators
// share, with no store of accounts. It never loads the accounts' store.

export { createSharedPassword } from './createSharedPassword.ts';
export type {
  SharedPassword,
  SharedPasswordOptions,
  SharedPasswordProtectOptions,
} from './sharedPasswordTypes.ts';
export type { SessionOptions } from './serviceAccountsTypes.ts';
export { DEFAULT_SIGN_IN_LIMIT } from './serviceAccountsTypes.ts';
export { readAccountConfig } from './accountConfig.ts';
export type { AccountConfig } from './accountConfig.ts';
export { hashPassword, verifyPassword } from './password.ts';
export { RENEW_AFTER_SECONDS, SESSION_SECONDS } from './sessions.ts';
export { SESSION_SCHEME, TOKEN_SCHEME } from './routes/schemas.ts';
export type { AccountSecuritySchemes } from './routes/schemas.ts';
export * from './rules.ts';
export type * from './types.ts';
