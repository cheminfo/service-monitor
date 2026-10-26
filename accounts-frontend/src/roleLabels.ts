import type { ChromeKey } from 'react-cheminfo/core';

import type { AccountRole } from './rules.ts';

/** The chrome key each role is written with. */
export const ROLE_LABEL_KEYS: Readonly<Record<AccountRole, ChromeKey>> = {
  read: 'account.role.read',
  write: 'account.role.write',
  admin: 'account.role.admin',
};
