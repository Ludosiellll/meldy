// The `telegram` Edge Function of @Meldyteach_bot (spec Telegram_Bot_Spec_2026-10-09 §6.1). Deploy with
// verify_jwt = false: Telegram and pg_net call it without a Supabase JWT; the webhook and the tick check their own
// HMAC headers (derived from TELEGRAM_BOT_TOKEN), /setup takes no input, /status shows no secret. The Mini App's
// /webapp/session (Telegram_Mini_App_Spec_2026-10-10) checks Telegram's initData signature itself.
//
// Deno glue only: the routes, the dispatch, the tick and every message are in ../_shared/bot/ (plain TS, tested with
// `node --experimental-strip-types --test supabase/functions/_shared/bot/*.test.ts`).
import { createDb } from '../_shared/bot/db.ts';
import { files } from '../_shared/bot/files.ts';
import { group } from '../_shared/bot/group.ts';
import { session } from '../_shared/bot/session.ts';
import { createVoice } from '../_shared/bot/voice.ts';
import { createAuthAdmin, createWebApp } from '../_shared/bot/webapp.ts';
import { createMonitor } from '../_shared/bot/monitor.ts';
import { readEnv } from '../_shared/bot/env.ts';
import { log } from '../_shared/bot/log.ts';
import { createApp, type Ports } from '../_shared/bot/router.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };
declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const env = readEnv();
const http = (input: string, init?: RequestInit) => fetch(input, init);

// The packages after T2, one line each:
const ports: Ports = {
  session, // T6: the session in chat (Z1–Z12, I1–I3)
  group, // T8: the group chat «Вопрос дня» (G1–G4, presses, tick steps 1, 2, 4)
  files, // T9: a forwarded file (F1) and GET /telegram/file
  // T10: a voice answer (V1–V4); off until bot.config.flags.voice is true. A factory: the file download needs the token.
  voice: createVoice({ token: env.token, fetch: http }),
  // The Mini App's sign-in: the token checks initData; Auth mints the one-time sign-in and checks the user's JWT.
  webapp: createWebApp({
    token: () => env.token,
    auth: env.supabaseUrl && env.serviceKey ? createAuthAdmin({ url: env.supabaseUrl, key: env.serviceKey, fetch: http }) : null,
  }),
  // The site's outage monitor (the tick's step «monitor»): off until bot.config.monitor_chat_id is set.
  monitor: createMonitor({ fetch: http }),
};
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
