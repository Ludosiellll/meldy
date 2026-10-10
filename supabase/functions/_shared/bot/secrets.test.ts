import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { derivedSecret, sameSecret } from './secrets.ts';
import { TEST_TOKEN } from './fixtures/fake_telegram.ts';

// Vectors: HMAC-SHA256(key = token, message = 'meldy:<purpose>:v1'), base64url without padding (spec decision 5).
const VECTORS = {
  webhook: 'jzZtebk6_r0h6JrVTL5-0KE_Foqm6AgzPNyEm18Zbm4',
  tick: 'EGVxaafvUkM8SPz2mHn8U_4RZ6lNZgVo-mPOGxKBn4k',
};
const OTHER_TOKEN = '654321:ANOTHER_TEST_TOKEN_NOT_REAL_yyyyyyyyyyyyy';

test('the derived secrets match the HMAC vectors and Telegram\'s secret_token alphabet', async () => {
  for (const purpose of ['webhook', 'tick'] as const) {
    const secret = await derivedSecret(TEST_TOKEN, purpose);
    assert.equal(secret, VECTORS[purpose]);
    assert.equal(secret, createHmac('sha256', TEST_TOKEN).update(`meldy:${purpose}:v1`).digest('base64url'));
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  }
  assert.notEqual(VECTORS.webhook, VECTORS.tick);
});

test('a new token gives new secrets (the cache follows the token)', async () => {
  assert.equal(await derivedSecret(OTHER_TOKEN, 'webhook'), 'BzgdmFQp95S080_DrQuuUixqqQDjlO3gtAzIdGSgSdY');
  assert.equal(await derivedSecret(TEST_TOKEN, 'webhook'), VECTORS.webhook);
  await assert.rejects(derivedSecret('', 'tick'));
});

test('sameSecret: equal only for the same string; a missing, shorter, longer or changed header fails', () => {
  const s = VECTORS.webhook;
  assert.equal(sameSecret(s, s), true);
  assert.equal(sameSecret(null, s), false);
  assert.equal(sameSecret(undefined, s), false);
  assert.equal(sameSecret('', s), false);
  assert.equal(sameSecret(s.slice(0, -1), s), false);
  assert.equal(sameSecret(`${s}x`, s), false);
  assert.equal(sameSecret(`${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`, s), false);
  assert.equal(sameSecret(VECTORS.tick, s), false);
  assert.equal(sameSecret(s, ''), false);
});
