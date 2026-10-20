/**
 * `POST /telegram/setup` and `GET /telegram/status` (spec §5, §6.1).
 *
 * /setup takes no input and runs at most once a minute (in this instance, and in `bot_setup`): `getMe` → `bot_setup`
 * (the username, the bot id, the tick token, the function URL and region for `bot.tick()`) → `bot_live_setup` (the live
 * game's token, x-meldy-live of the database's calls to /game/post and /game/sync; a database without the live game
 * marks the step failed and setup goes on) → `setWebhook` (the
 * function's URL with `forceFunctionRegion`, the derived `secret_token`, `allowed_updates`, `max_connections = 10`) →
 * the profile: name, descriptions, the commands of private chats (none by default, so groups show none), the menu
 * button «Открыть Meldy» that opens the Mini App (Telegram_Mini_App_Spec_2026-10-10, decision 1; the commands stay a
 * «/» away), the photo when the bot has none. The answer names each step's outcome and holds no secret.
 *
 * /status is public: Telegram's pending updates and last error, the last tick and setup, the calls this month, the
 * region the function ran in. No token, no secret, no user count.
 */
import { avatarBytes } from './avatar.ts';
import { derivedSecret } from './secrets.ts';
import { errorName } from './log.ts';
import type { Ctx } from './router.ts';
import { TelegramError } from './tg.ts';
import { PATH, PROFILE } from './words.ts';

/** The default menu button of private chats: Meldy as a Mini App (MenuButtonWebApp, Bot API setChatMenuButton). */
export function menuButton(site: string): { type: 'web_app'; text: string; web_app: { url: string } } {
  return { type: 'web_app', text: PROFILE.menuButton, web_app: { url: `${site}${PATH.miniApp()}` } };
}

/**
 * The region the webhook and the tick ask Supabase to run the function in: Frankfurt, the nearest region regional
 * invocation supports to the database (Stockholm is not on its list).
 */
export const FUNCTION_REGION = 'eu-central-1';
export const ALLOWED_UPDATES: readonly string[] = ['message', 'callback_query', 'my_chat_member'];
export const MAX_CONNECTIONS = 10;

/** The webhook's address: the function URL (`https://<ref>.supabase.co/functions/v1/telegram`) pinned to the region. */
export function webhookUrl(functionUrl: string): string {
  return `${functionUrl}?forceFunctionRegion=${FUNCTION_REGION}`;
}

export type StepResult = 'ok' | 'skipped' | 'failed';

export interface SetupResult {
  ok: boolean;
  error?: string;
  bot?: string;
  steps: Record<string, StepResult>;
}

const describe = (error: unknown) => (error instanceof TelegramError ? `${error.method}:${error.code}` : errorName(error));

export async function runSetup(ctx: Ctx, deps: { token: string; functionUrl: string }): Promise<SetupResult> {
  const steps: Record<string, StepResult> = {};
  let me: { id: number; username: string };
  try {
    me = await ctx.tg.call<{ id: number; username: string }>('getMe');
    steps.getMe = 'ok';
  } catch (error) {
    return { ok: false, error: describe(error), steps: { ...steps, getMe: 'failed' } };
  }
  const saved = await ctx.db.setup({
    username: me.username, botId: me.id, tickToken: await derivedSecret(deps.token, 'tick'), functionUrl: deps.functionUrl, functionRegion: FUNCTION_REGION,
  });
  if (saved.status === 'slow_down') return { ok: false, error: 'slow_down', bot: me.username, steps: { ...steps, bot_setup: 'skipped' } };
  steps.bot_setup = 'ok';
  try {
    await ctx.db.rpc('bot_live_setup', { p_live_token: await derivedSecret(deps.token, 'live') });
    steps.bot_live_setup = 'ok';
  } catch {
    steps.bot_live_setup = 'failed';
  }
  try {
    await ctx.tg.call('setWebhook', {
      url: webhookUrl(deps.functionUrl),
      secret_token: await derivedSecret(deps.token, 'webhook'),
      allowed_updates: [...ALLOWED_UPDATES],
      max_connections: MAX_CONNECTIONS,
    });
    steps.setWebhook = 'ok';
  } catch (error) {
    return { ok: false, error: describe(error), bot: me.username, steps: { ...steps, setWebhook: 'failed' } };
  }

  const profile: Array<[string, () => Promise<unknown>]> = [
    ['setMyName', () => ctx.tg.call('setMyName', { name: PROFILE.name })],
    ['setMyDescription', () => ctx.tg.call('setMyDescription', { description: PROFILE.description })],
    ['setMyShortDescription', () => ctx.tg.call('setMyShortDescription', { short_description: PROFILE.shortDescription })],
    ['setMyCommands', () => ctx.tg.call('setMyCommands', { commands: PROFILE.commands, scope: { type: 'all_private_chats' } })],
    ['deleteMyCommands', () => ctx.tg.call('deleteMyCommands', { scope: { type: 'default' } })],
    // Without chat_id: the default for every private chat.
    ['setChatMenuButton', () => ctx.tg.call('setChatMenuButton', { menu_button: menuButton(ctx.site) })],
  ];
  let failed: string | undefined;
  for (const [name, run] of profile) {
    try {
      await run();
      steps[name] = 'ok';
    } catch (error) {
      steps[name] = 'failed';
      failed ??= describe(error);
    }
  }
  try {
    const photos = await ctx.tg.call<{ total_count: number }>('getUserProfilePhotos', { user_id: me.id, limit: 1 });
    if (photos.total_count > 0) steps.setMyProfilePhoto = 'skipped';
    else {
      await ctx.tg.upload('setMyProfilePhoto', { photo: { type: 'static', photo: 'attach://avatar' } },
        { avatar: { name: 'meldy.jpg', type: 'image/jpeg', bytes: avatarBytes() } });
      steps.setMyProfilePhoto = 'ok';
    }
  } catch (error) {
    steps.setMyProfilePhoto = 'failed';
    failed ??= describe(error);
  }
  return failed ? { ok: false, error: failed, bot: me.username, steps } : { ok: true, bot: me.username, steps };
}

export interface StatusBody {
  ok: boolean;
  /** The region this instance ran in (SB_REGION). */
  region: string | null;
  /** The region the webhook and the tick ask for. */
  function_region: string;
  webhook: {
    url_ok: boolean;
    pending_update_count: number | null;
    last_error_date: string | null;
    last_error_message: string | null;
    max_connections: number | null;
    allowed_updates: string[] | null;
  } | null;
  configured: boolean | null;
  bot_username: string | null;
  /** every_minute, or when_due past 60 % of the free plan's calls this month. */
  tick_mode: string | null;
  last_setup_at: string | null;
  last_tick_at: string | null;
  calls: { month: string | null; updates: number; ticks: number; total: number } | null;
  ledger: { started: number; failed: number; done: number } | null;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

export async function readStatus(ctx: Ctx, deps: { functionUrl: string; region: string | null }): Promise<StatusBody> {
  const [info, status] = await Promise.all([
    ctx.tg.call<WebhookInfo>('getWebhookInfo').catch(() => null),
    ctx.db.status().catch(() => null),
  ]);
  return {
    ok: info !== null && status !== null,
    region: deps.region,
    function_region: FUNCTION_REGION,
    webhook: info
      ? {
          url_ok: info.url === webhookUrl(deps.functionUrl),
          pending_update_count: typeof info.pending_update_count === 'number' ? info.pending_update_count : null,
          last_error_date: typeof info.last_error_date === 'number' ? new Date(info.last_error_date * 1000).toISOString() : null,
          last_error_message: typeof info.last_error_message === 'string' ? info.last_error_message.slice(0, 200) : null,
          max_connections: typeof info.max_connections === 'number' ? info.max_connections : null,
          allowed_updates: Array.isArray(info.allowed_updates) ? info.allowed_updates.map(String) : null,
        }
      : null,
    configured: status ? status.configured : null,
    bot_username: status ? status.botUsername : null,
    tick_mode: status ? status.tickMode : null,
    last_setup_at: status ? status.lastSetupAt : null,
    last_tick_at: status ? status.lastTickAt : null,
    calls: status ? status.calls : null,
    ledger: status ? status.ledger : null,
  };
}
