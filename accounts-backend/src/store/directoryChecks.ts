import type { AccountDirectory } from './AccountDirectory.ts';
import type { Report } from './directoryCheckHelpers.ts';
import { add, reportRow, roleOf, row } from './directoryCheckHelpers.ts';

/** One check, run on a directory holding no account. */
type DirectoryCheck = (directory: AccountDirectory, report: Report) => void;

/**
 * The checks of `accountDirectoryProblems`, by name. Each starts from a
 * directory holding no account.
 */
export const DIRECTORY_CHECKS: Readonly<Record<string, DirectoryCheck>> = {
  rows(directory, report) {
    const id = add(directory, 'luc', 'admin');
    report(Number.isInteger(id) && id > 0, `insert answered the id ${id}`);
    const expected = row(id, 'luc', 'admin');
    reportRow(report, 'byId', directory.byId(id), expected);
    reportRow(report, 'byUsername', directory.byUsername('luc'), expected);
    report(directory.byId(id + 1) === undefined, 'byId found a missing id');
    report(
      directory.byUsername('nobody') === undefined,
      'byUsername found a missing username',
    );
    report(directory.count() === 1, `count answered ${directory.count()}`);
  },

  uniqueUsernames(directory, report) {
    add(directory, 'luc', 'read');
    let threw = false;
    try {
      add(directory, 'luc', 'write');
    } catch {
      threw = true;
    }
    report(threw, 'insert took a username already taken');
    report(directory.count() === 1, `count answered ${directory.count()}`);
  },

  allByUsername(directory, report) {
    for (const username of ['mia', 'ada', 'luc']) add(directory, username);
    const usernames = directory.all().map((account) => account.username);
    report(
      usernames.join(',') === 'ada,luc,mia',
      `all answered ${usernames.join(', ')}, expected ada, luc, mia`,
    );
    report(directory.count() === 3, `count answered ${directory.count()}`);
  },

  passwordAndSignIn(directory, report) {
    const id = add(directory, 'luc');
    report(directory.setPassword(id, 'hash-new', 2000), 'setPassword refused');
    directory.touchSignIn(id, 3000);
    reportRow(report, 'byId', directory.byId(id), {
      ...row(id, 'luc', 'read'),
      passwordHash: 'hash-new',
      passwordChangedAt: 2000,
      lastSignInAt: 3000,
    });
    report(
      !directory.setPassword(id + 1, 'hash-new', 2000),
      'setPassword answered true for a missing id',
    );
  },

  lastAdmin(directory, report) {
    const luc = add(directory, 'luc', 'admin');
    const ada = add(directory, 'ada', 'read');
    report(directory.setRole(ada, 'write'), 'setRole refused a reader');
    report(roleOf(directory, ada) === 'write', 'setRole wrote no role');
    report(!directory.setRole(luc, 'read'), 'setRole demoted the last admin');
    report(
      !directory.removeUnlessLastAdmin(luc),
      'removeUnlessLastAdmin removed the last admin',
    );
    report(roleOf(directory, luc) === 'admin', 'the last admin lost its role');
    report(directory.setRole(ada, 'admin'), 'setRole refused to promote');
    report(
      directory.setRole(luc, 'read'),
      'setRole refused to demote an admin while another is left',
    );
    report(!directory.setRole(ada, 'write'), 'setRole demoted the last admin');
    report(
      directory.removeUnlessLastAdmin(luc),
      'removeUnlessLastAdmin refused a reader',
    );
    report(directory.byId(luc) === undefined, 'a removed account is found');
    report(
      !directory.removeUnlessLastAdmin(luc),
      'removeUnlessLastAdmin answered true for a missing id',
    );
    report(
      !directory.setRole(luc, 'write'),
      'setRole answered true for a missing id',
    );
  },

  envAdmin(directory, report) {
    const luc = add(directory, 'luc', 'read');
    const kept = directory.writeEnvAdmin({
      username: 'luc',
      passwordHash: 'hash-luc',
      at: 2000,
    });
    report(kept === luc, 'writeEnvAdmin added a username already there');
    reportRow(report, 'byId', directory.byId(luc), {
      ...row(luc, 'luc', 'admin'),
      envManaged: true,
    });
    directory.writeEnvAdmin({ username: 'luc', passwordHash: 'h2', at: 3000 });
    const changed = directory.byId(luc);
    report(
      changed?.passwordHash === 'h2' && changed.passwordChangedAt === 3000,
      'writeEnvAdmin did not replace the hash and its date',
    );
    const root = directory.writeEnvAdmin({
      username: 'root',
      passwordHash: 'hash-root',
      at: 4000,
    });
    reportRow(report, 'byId', directory.byId(root), {
      ...row(root, 'root', 'admin'),
      envManaged: true,
      createdAt: 4000,
      passwordChangedAt: 4000,
    });
    report(
      directory.byId(luc)?.envManaged === false,
      'writeEnvAdmin left a second account marked',
    );
  },

  envAdminRefused(directory, report) {
    add(directory, 'luc', 'admin');
    const root = directory.writeEnvAdmin({
      username: 'root',
      passwordHash: 'hash-root',
      at: 2000,
    });
    report(
      !directory.setPassword(root, 'x', 3000),
      'setPassword changed the account the .env defines',
    );
    report(
      !directory.setRole(root, 'read'),
      'setRole changed the account the .env defines',
    );
    report(
      !directory.removeUnlessLastAdmin(root),
      'removeUnlessLastAdmin removed the account the .env defines',
    );
    const kept = directory.byId(root);
    report(
      kept?.passwordHash === 'hash-root' && kept.role === 'admin',
      'the account the .env defines was changed',
    );
    report(
      directory.forgetEnvAdmins() === 1,
      'forgetEnvAdmins did not count the one account marked',
    );
    report(
      directory.byId(root)?.envManaged === false,
      'forgetEnvAdmins left the account marked',
    );
    report(
      directory.forgetEnvAdmins() === 0,
      'forgetEnvAdmins counted an account no longer marked',
    );
  },
};
