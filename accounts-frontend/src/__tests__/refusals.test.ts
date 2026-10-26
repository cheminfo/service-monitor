import { CHROME_CATALOG, LANGUAGES } from 'react-cheminfo/core';
import { beforeAll, expect, test } from 'vitest';

import { ACCOUNT_REFUSALS, REFUSAL_MESSAGES } from '../rules.ts';
import { refusalKey, refusalValues } from '../useAccountFailureText.ts';

beforeAll(async () => {
  for (const language of LANGUAGES) {
    // eslint-disable-next-line no-await-in-loop -- one catalog after the other
    await CHROME_CATALOG.load(language);
  }
});

test('the server says in English what the chrome says, for every refusal', () => {
  const english = ACCOUNT_REFUSALS.map((code) =>
    CHROME_CATALOG.translate(refusalKey(code), 'en', {
      values: refusalValues(code),
    }),
  );

  expect(english).toStrictEqual(
    ACCOUNT_REFUSALS.map((code) => REFUSAL_MESSAGES[code]),
  );
});

test('every refusal is written in every language of the family, its limits filled in', () => {
  const unwritten: string[] = [];
  for (const language of LANGUAGES) {
    for (const code of ACCOUNT_REFUSALS) {
      const text = CHROME_CATALOG.translate(refusalKey(code), language, {
        values: refusalValues(code),
      });
      if (language !== 'en' && text === REFUSAL_MESSAGES[code]) {
        unwritten.push(`${language} ${code}`);
      }
      if (/[{}]/.test(text)) unwritten.push(`${language} ${code}: ${text}`);
    }
  }

  expect(unwritten).toStrictEqual([]);
  expect(
    CHROME_CATALOG.translate(refusalKey('usernameLength'), 'fr', {
      values: refusalValues('usernameLength'),
    }),
  ).toBe("Un nom d'utilisateur compte de 3 à 30 caractères.");
});
