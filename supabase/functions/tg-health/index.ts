// Says whether the Telegram bot token is set in this project's secrets and works.
// It never returns or logs the token: only its presence, Telegram's verdict and the bot's public name.
// Deployed to the StudyForge Supabase project as `tg-health` (verify_jwt on: call it with the app's public key).

const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const KEEP_MS = 5 * 60_000;

let good: { at: number; body: Record<string, unknown> } | null = null;

async function check(): Promise<Record<string, unknown>> {
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();
  if (!token) return { configured: false };
  if (!TOKEN_SHAPE.test(token)) return { configured: true, shape_ok: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      const me = data.result ?? {};
      return {
        configured: true,
        shape_ok: true,
        reachable: true,
        valid: true,
        username: me.username ?? null,
        can_join_groups: me.can_join_groups ?? null,
        can_read_all_group_messages: me.can_read_all_group_messages ?? null,
      };
    }
    return { configured: true, shape_ok: true, reachable: true, valid: false, status: res.status };
  } catch (error) {
    // Only the error's name: a network error's message can carry the request URL, and the URL holds the token.
    return { configured: true, shape_ok: true, reachable: false, error: (error as Error)?.name ?? 'Error' };
  }
}

Deno.serve(async () => {
  if (good && Date.now() - good.at < KEEP_MS) return Response.json(good.body);
  const body = await check();
  if (body.valid === true) good = { at: Date.now(), body };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
});
