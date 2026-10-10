// env.ts: the new secret key from SUPABASE_SECRET_KEYS (JSON, `default`), else the legacy service_role key; the
// function URL from SUPABASE_URL; the region from SB_REGION. Run under Node with a stand-in for Deno.env.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnv } from './env.ts';

function withEnv(values: Record<string, string>, run: () => void) {
  const g = globalThis as unknown as { Deno?: unknown };
  const before = g.Deno;
  g.Deno = { env: { get: (name: string) => values[name] } };
  try {
    run();
  } finally {
    g.Deno = before;
  }
}

test('the secret key, the function URL and the region', () => {
  withEnv({
    TELEGRAM_BOT_TOKEN: ' 123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxxx ', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/',
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_TEST_NOT_REAL"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy', SB_REGION: 'eu-central-1',
  }, () => {
    assert.deepEqual(readEnv(), {
      token: '123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxxx', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      serviceKey: 'sb_secret_TEST_NOT_REAL', functionUrl: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram', region: 'eu-central-1',
    });
  });
  withEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt' }, () => {
    const env = readEnv();
    assert.equal(env.serviceKey, 'legacy-jwt');
    assert.equal(env.token, '');
    assert.equal(env.region, null);
  });
  withEnv({ SUPABASE_SECRET_KEYS: '{"other":"sb_secret_x"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt' }, () => {
    assert.equal(readEnv().serviceKey, 'legacy-jwt');
  });
});
