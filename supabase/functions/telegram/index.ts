// The `telegram` Edge Function of @Meldyteach_bot (spec Telegram_Bot_Spec_2026-10-09 §6.1). Deploy with
// verify_jwt = false: Telegram and pg_net call it without a Supabase JWT; the webhook and the tick check their own
// HMAC headers (derived from TELEGRAM_BOT_TOKEN), /setup takes no input, /status shows no secret.
//
// Deno glue only: the routes, the dispatch, the tick and every message are in ../_shared/bot/ (plain TS, tested with
// `node --experimental-strip-types --test supabase/functions/_shared/bot/*.test.ts`).
import { createDb } from '../_shared/bot/db.ts';
import { readEnv } from '../_shared/bot/env.ts';
import { log } from '../_shared/bot/log.ts';
import { createApp, STUBS, type Ports } from '../_shared/bot/router.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };
declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

// The packages after T2 plug in here, one line each, when they merge:
const ports: Ports = {
  session: STUBS.session, // T6: `import { session } from '../_shared/bot/session.ts';` and `session,`
  group: STUBS.group, // T8: `import { group } from '../_shared/bot/group.ts';` and `group,`
  files: STUBS.files, // T9: `import { files } from '../_shared/bot/files.ts';` and `files,` (GET /telegram/file)
  voice: STUBS.voice, // T10: `import { voice } from '../_shared/bot/voice.ts';` and `voice,`
};

const env = readEnv();
const http = (input: string, init?: RequestInit) => fetch(input, init);
const app = env.token && env.supabaseUrl && env.serviceKey
  ? createApp({
      token: env.token,
      fetch: http,
      db: createDb({ url: env.supabaseUrl, key: env.serviceKey, fetch: http }),
      functionUrl: env.functionUrl,
      region: env.region,
      ports,
      // The tick answers 202 at once and works after the response (spec §6.6).
      waitUntil: (work) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(work) : void work.catch(() => undefined)),
    })
  : null;

Deno.serve((req: Request) => {
  if (!app) {
    log({ route: 'http', outcome: 'not_configured' });
    return new Response(null, { status: 503 });
  }
  return app(req);
});
