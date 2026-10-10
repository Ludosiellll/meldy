/**
 * The function's environment — Deno only (with supabase/functions/telegram/index.ts). The rest of the bot is plain TS
 * that gets these values passed in, so it runs under `node --test` too.
 *
 * - TELEGRAM_BOT_TOKEN: the one owner secret (never logged, never returned).
 * - SUPABASE_URL: `https://<ref>.supabase.co`; the function's own URL is `${SUPABASE_URL}/functions/v1/telegram`.
 * - The service key: SUPABASE_SECRET_KEYS (JSON, key `default`), else the legacy SUPABASE_SERVICE_ROLE_KEY (ends with 2026).
 * - SB_REGION: the region this instance runs in (for /status).
 * Nothing else: in particular no database connection string (a test greps the bot for it).
 */
declare const Deno: { env: { get(name: string): string | undefined } };

export interface BotEnv {
  token: string;
  supabaseUrl: string;
  serviceKey: string;
  functionUrl: string;
  region: string | null;
}

export function readEnv(): BotEnv {
  const get = (name: string) => (Deno.env.get(name) ?? '').trim();
  const supabaseUrl = get('SUPABASE_URL').replace(/\/+$/, '');
  let serviceKey = '';
  const keys = get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown>;
      if (typeof parsed.default === 'string') serviceKey = parsed.default;
    } catch {
      serviceKey = '';
    }
  }
  if (!serviceKey) serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');
  return {
    token: get('TELEGRAM_BOT_TOKEN'),
    supabaseUrl,
    serviceKey,
    functionUrl: `${supabaseUrl}/functions/v1/telegram`,
    region: get('SB_REGION') || null,
  };
}
