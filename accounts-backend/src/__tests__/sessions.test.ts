import { expect, test } from 'vitest';

import { SESSION_SECONDS, createSessions } from '../sessions.ts';
import type { AccountRow } from '../store/AccountStore.ts';

const PURPOSE = 'test.cheminfo.org operator session';
const SECRET = { purpose: PURPOSE, secret: 'a cookie secret of some length' };

/** 2026-10-02T12:00:00Z, so every expiry below is a fixed number. */
const NOW = Date.UTC(2026, 9, 2, 12);

const LUC: AccountRow = {
  id: 7,
  username: 'luc',
  passwordHash: 'pbkdf2$sha512$210000$c2FsdA==$aGFzaA==',
  createdAt: 1_790_000_000,
  passwordChangedAt: 1_790_000_000,
  lastSignInAt: null,
};

/**
 * Read accounts the way the server does, from a fixed list.
 * @param users - the accounts there are
 * @returns the lookup a verification takes
 */
function accounts(...users: AccountRow[]) {
  return (id: number) => users.find((user) => user.id === id);
}

test('a session names its account, ends eight hours on, and is signed', async () => {
  const sessions = await createSessions(SECRET);

  const session = await sessions.open(LUC, NOW);

  const expiresAt = NOW / 1000 + SESSION_SECONDS;

  expect(session).toMatch(
    new RegExp(String.raw`^7\.${expiresAt}\.[\da-f]{64}$`),
  );
  await expect(
    sessions.verify(session, accounts(LUC), NOW),
  ).resolves.toStrictEqual(LUC);
  await expect(
    sessions.verify(session, accounts(LUC), (expiresAt - 1) * 1000),
  ).resolves.toStrictEqual(LUC);
  await expect(
    sessions.verify(session, accounts(LUC), expiresAt * 1000),
  ).resolves.toBeNull();
});

test('a session that was changed, or signed elsewhere, is refused', async () => {
  const sessions = await createSessions(SECRET);
  const session = await sessions.open(LUC, NOW);
  const [userId = '', expiresAt = '', signature = ''] = session.split('.');
  const flipped = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
  const other = { ...LUC, id: 8, username: 'ada' };

  // An earlier expiry is still inside the eight hours, and account 8 exists:
  // only the signature refuses them.
  const refused = [
    `${userId}.${Number(expiresAt) - 60}.${signature}`,
    `8.${expiresAt}.${signature}`,
    `${userId}.${expiresAt}.${flipped}`,
    `${userId}.${expiresAt}.`,
    `${expiresAt}.${signature}`,
    '',
    undefined,
  ];
  const answers = [];
  for (const value of refused) {
    // eslint-disable-next-line no-await-in-loop -- one check after the other keeps each answer apart
    answers.push(await sessions.verify(value, accounts(LUC, other), NOW));
  }

  expect(answers).toStrictEqual([null, null, null, null, null, null, null]);

  const otherSecret = await createSessions({
    purpose: PURPOSE,
    secret: 'another secret',
  });

  await expect(
    otherSecret.verify(session, accounts(LUC), NOW),
  ).resolves.toBeNull();
});

test('a new password, or a removed account, ends the sessions it had', async () => {
  const sessions = await createSessions(SECRET);
  const session = await sessions.open(LUC, NOW);
  const changed = { ...LUC, passwordHash: 'pbkdf2$sha512$210000$bmV3$bmV3' };

  await expect(
    sessions.verify(session, accounts(changed), NOW),
  ).resolves.toBeNull();
  await expect(sessions.verify(session, accounts(), NOW)).resolves.toBeNull();
});

test('with a secret a session outlives a restart; without, it does not', async () => {
  const before = await createSessions(SECRET);
  const session = await before.open(LUC, NOW);
  const restarted = await createSessions(SECRET);

  const randomKey = await createSessions({ purpose: PURPOSE });
  const randomSession = await randomKey.open(LUC, NOW);
  const randomRestarted = await createSessions({
    purpose: PURPOSE,
    secret: '  ',
  });

  await expect(
    restarted.verify(session, accounts(LUC), NOW),
  ).resolves.toStrictEqual(LUC);
  await expect(
    randomKey.verify(randomSession, accounts(LUC), NOW),
  ).resolves.toStrictEqual(LUC);
  await expect(
    randomRestarted.verify(randomSession, accounts(LUC), NOW),
  ).resolves.toBeNull();
});

test('a session lasting longer than a sign-in grants is refused', async () => {
  const sessions = await createSessions(SECRET);

  // Opened an hour from now: valid then, but nine hours away from now.
  const ahead = await sessions.open(LUC, NOW + 3_600_000);

  await expect(sessions.verify(ahead, accounts(LUC), NOW)).resolves.toBeNull();
  await expect(
    sessions.verify(ahead, accounts(LUC), NOW + 3_600_000),
  ).resolves.toStrictEqual(LUC);
});

test('a session signed for another purpose is refused', async () => {
  const chembio = await createSessions(SECRET);
  const molecules = await createSessions({
    ...SECRET,
    purpose: 'molecules.cheminfo.org administrator session',
  });

  const session = await chembio.open(LUC, NOW);

  await expect(
    molecules.verify(session, accounts(LUC), NOW),
  ).resolves.toBeNull();
  await expect(
    chembio.verify(session, accounts(LUC), NOW),
  ).resolves.toStrictEqual(LUC);
});
