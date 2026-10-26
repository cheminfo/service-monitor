import { expect, test } from 'vitest';

import type { VerifiedSession } from '../sessions.ts';
import {
  RENEW_AFTER_SECONDS,
  SESSION_SECONDS,
  createSessions,
  shouldRenew,
} from '../sessions.ts';
import type { AccountRow } from '../store/AccountStore.ts';

const PURPOSE = 'test.cheminfo.org session';
const SECRET = { purpose: PURPOSE, secret: 'a cookie secret of some length' };

/** 2026-10-02T12:00:00Z, so every expiry below is a fixed number. */
const NOW = Date.UTC(2026, 9, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

const LUC: AccountRow = {
  id: 7,
  username: 'luc',
  passwordHash: 'pbkdf2$sha512$210000$c2FsdA==$aGFzaA==',
  role: 'admin',
  envManaged: false,
  createdAt: 1_790_000_000,
  passwordChangedAt: 1_790_000_000,
  lastSignInAt: null,
};

/**
 * Read accounts the way the server does, from a fixed list.
 * @param users - The accounts there are.
 * @returns The lookup a verification takes.
 */
function accounts(...users: AccountRow[]) {
  return (id: number) => users.find((user) => user.id === id);
}

test('a session lasts 400 days, the longest a browser keeps a cookie', () => {
  expect(SESSION_SECONDS).toBe(34_560_000);
  expect(RENEW_AFTER_SECONDS).toBe(86_400);
});

test('a session names its account, ends 400 days on, and is signed', async () => {
  const sessions = await createSessions(SECRET);

  const session = await sessions.open(LUC, NOW);

  const expiresAt = NOW / 1000 + SESSION_SECONDS;

  expect(session).toMatch(
    new RegExp(String.raw`^7\.${expiresAt}\.[\da-f]{64}$`),
  );
  await expect(
    sessions.verify(session, accounts(LUC), NOW),
  ).resolves.toStrictEqual({ account: LUC, expiresAt });
  await expect(
    sessions.verify(session, accounts(LUC), (expiresAt - 1) * 1000),
  ).resolves.toStrictEqual({ account: LUC, expiresAt });
  await expect(
    sessions.verify(session, accounts(LUC), expiresAt * 1000),
  ).resolves.toBeNull();
});

test('a session signed for eight hours, as 0.1.0 signed them, still verifies', async () => {
  const sessions = await createSessions(SECRET);
  const expiresAt = NOW / 1000 + 8 * 60 * 60;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(
        `${PURPOSE}\n7\n${expiresAt}\n${LUC.passwordHash}`,
      ),
    ),
  );
  const hex = [...signature]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  await expect(
    sessions.verify(`7.${expiresAt}.${hex}`, accounts(LUC), NOW),
  ).resolves.toStrictEqual({ account: LUC, expiresAt });
});

test('a session that was changed, or signed elsewhere, is refused', async () => {
  const sessions = await createSessions(SECRET);
  const session = await sessions.open(LUC, NOW);
  const [userId = '', expiresAt = '', signature = ''] = session.split('.');
  const flipped = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
  const other = { ...LUC, id: 8, username: 'ada' };

  // An earlier expiry is still inside the 400 days, and account 8 exists:
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

test('a new password, or a removed account, ends the sessions it had; a new role does not', async () => {
  const sessions = await createSessions(SECRET);
  const session = await sessions.open(LUC, NOW);
  const changed = { ...LUC, passwordHash: 'pbkdf2$sha512$210000$bmV3$bmV3' };
  const demoted = { ...LUC, role: 'read' as const };

  await expect(
    sessions.verify(session, accounts(changed), NOW),
  ).resolves.toBeNull();
  await expect(sessions.verify(session, accounts(), NOW)).resolves.toBeNull();
  await expect(
    sessions.verify(session, accounts(demoted), NOW),
  ).resolves.toStrictEqual({
    account: demoted,
    expiresAt: NOW / 1000 + SESSION_SECONDS,
  });
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
  ).resolves.not.toBeNull();
  await expect(
    randomKey.verify(randomSession, accounts(LUC), NOW),
  ).resolves.not.toBeNull();
  await expect(
    randomRestarted.verify(randomSession, accounts(LUC), NOW),
  ).resolves.toBeNull();
});

test('a session lasting longer than a sign-in grants is refused', async () => {
  const sessions = await createSessions(SECRET);

  // Opened an hour from now: valid then, but 400 days and an hour from now.
  const ahead = await sessions.open(LUC, NOW + 3_600_000);

  await expect(sessions.verify(ahead, accounts(LUC), NOW)).resolves.toBeNull();
  await expect(
    sessions.verify(ahead, accounts(LUC), NOW + 3_600_000),
  ).resolves.not.toBeNull();
});

test('a session signed for another purpose is refused', async () => {
  const drugs = await createSessions(SECRET);
  const molecules = await createSessions({
    ...SECRET,
    purpose: 'molecules.cheminfo.org administrator session',
  });

  const session = await drugs.open(LUC, NOW);

  await expect(
    molecules.verify(session, accounts(LUC), NOW),
  ).resolves.toBeNull();
  await expect(
    drugs.verify(session, accounts(LUC), NOW),
  ).resolves.not.toBeNull();
});

test('a session is handed out again once it is more than a day old', async () => {
  const sessions = await createSessions(SECRET);
  const verified = (await sessions.verify(
    await sessions.open(LUC, NOW),
    accounts(LUC),
    NOW,
  )) as VerifiedSession;

  expect(verified.expiresAt).toBe(NOW / 1000 + SESSION_SECONDS);
  expect(
    [0, DAY - 1000, DAY, DAY + 1000, 300 * DAY].map((age) =>
      shouldRenew(verified, NOW + age),
    ),
  ).toStrictEqual([false, false, false, true, true]);
});
