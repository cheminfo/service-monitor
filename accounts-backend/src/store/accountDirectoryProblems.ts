import type { AccountDirectory } from './AccountDirectory.ts';
import { DIRECTORY_CHECKS } from './directoryChecks.ts';

/** Opens a directory holding no account, for one check. */
export type OpenEmptyDirectory = () =>
  AccountDirectory | Promise<AccountDirectory>;

/**
 * What an implementation of `AccountDirectory` does differently from what
 * the package relies on: the rows it answers, usernames unique, the last
 * administrator neither demoted nor removed, the account the `.env` defines
 * changed by the `.env` alone. `AccountStore` answers none; a host's test of
 * its own directory asserts the same, with any test runner.
 *
 * ```ts
 * test('the contacts are accounts', async () => {
 *   const problems = await accountDirectoryProblems(() => openContacts(':memory:'));
 *   expect(problems).toStrictEqual([]);
 * });
 * ```
 * @param open - opens a directory holding no account, called once per check
 * so the checks never see each other's accounts
 * @returns one sentence per problem, prefixed with the check that found it;
 * none when the directory keeps every guarantee
 */
export async function accountDirectoryProblems(
  open: OpenEmptyDirectory,
): Promise<string[]> {
  const runs = await Promise.all(
    Object.entries(DIRECTORY_CHECKS).map(async ([name, check]) => ({
      name,
      check,
      directory: await open(),
    })),
  );
  const problems: string[] = [];
  for (const { name, check, directory } of runs) {
    const report = (holds: boolean, problem: string) => {
      if (!holds) problems.push(`${name}: ${problem}`);
    };
    try {
      check(directory, report);
    } catch (error: unknown) {
      report(false, `threw ${String(error)}`);
    }
  }
  return problems;
}
