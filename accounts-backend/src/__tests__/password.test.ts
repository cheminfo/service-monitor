import { expect, test } from 'vitest';

import { hashPassword, verifyPassword } from '../password.ts';

test('a hash is PBKDF2-SHA-512, salted, and only its own password matches', async () => {
  const first = await hashPassword('lpc');
  const second = await hashPassword('lpc');

  expect(first).toMatch(
    /^pbkdf2\$sha512\$210000\$[\d+/A-Za-z]{22}==\$[\d+/A-Za-z]{86}==$/,
  );
  expect(second).not.toBe(first);
  await expect(verifyPassword('lpc', first)).resolves.toBe(true);
  await expect(verifyPassword('lpc', second)).resolves.toBe(true);
  await expect(verifyPassword('LPC', first)).resolves.toBe(false);
  await expect(verifyPassword('', first)).resolves.toBe(false);
});

test('a hash written by learn.cheminfo.org is read here', async () => {
  // Written by learn's own hashPassword, for the password 'lpc'.
  const stored =
    'pbkdf2$sha512$210000$6skChfhrHP7bDMMP70JZXA==$CEh2GYDs02XqsE2tjU7Fw4qWp/UrEufLWcxBRBsaxsSo8j7Ssh8iy+mth2MoHd6H2uAo1mfpdWMcRDMPWf5hcw==';

  await expect(verifyPassword('lpc', stored)).resolves.toBe(true);
  await expect(verifyPassword('lpd', stored)).resolves.toBe(false);
});

test('a hash that cannot be read matches nothing, and does not throw', async () => {
  const valid = await hashPassword('lpc');
  const [, , iterations = '', salt = '', hash = ''] = valid.split('$');
  const damaged = [
    '',
    'lpc',
    `bcrypt$sha512$${iterations}$${salt}$${hash}`,
    `pbkdf2$sha256$${iterations}$${salt}$${hash}`,
    `pbkdf2$sha512$0$${salt}$${hash}`,
    `pbkdf2$sha512$many$${salt}$${hash}`,
    `pbkdf2$sha512$${iterations}$$${hash}`,
    `pbkdf2$sha512$${iterations}$${salt}$not base64!`,
    `pbkdf2$sha512$${iterations}$${salt}$${hash}$extra`,
  ];

  const answers = [];
  for (const stored of damaged) {
    // eslint-disable-next-line no-await-in-loop -- one check after the other keeps each answer apart
    answers.push(await verifyPassword('lpc', stored));
  }

  expect(answers).toStrictEqual(damaged.map(() => false));
});
