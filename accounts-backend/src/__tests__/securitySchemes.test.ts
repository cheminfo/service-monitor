import type { OpenAPIV3, OpenAPIV3_1 as OpenAPIV31 } from 'openapi-types';
import { expect, test } from 'vitest';

import { accountSecuritySchemes } from '../routes/schemas.ts';

test('the security schemes go to components.securitySchemes of an OpenAPI document as they are', () => {
  const plain = accountSecuritySchemes('test_session');
  const withTokens = accountSecuritySchemes('test_session', {
    accountTokens: true,
    queryToken: true,
  });

  // `@fastify/swagger` types its `openapi` option with these documents, so
  // these assignments are the test, checked by `npm run check-types`.
  const version3: OpenAPIV3.ComponentsObject = { securitySchemes: plain };
  const version31: OpenAPIV31.ComponentsObject = {
    securitySchemes: withTokens,
  };

  expect(Object.keys(version3.securitySchemes ?? {})).toStrictEqual([
    'accountSession',
    'operatorToken',
  ]);
  expect(Object.keys(version31.securitySchemes ?? {})).toStrictEqual([
    'accountSession',
    'operatorToken',
    'accountToken',
    'queryToken',
  ]);
});
