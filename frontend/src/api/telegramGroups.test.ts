import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Supabase client, replaced: RPCs are recorded and answered by `db.rpc`. */
interface Answer { data: unknown; error: unknown; status?: number }

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ name: string; args: Record<string, unknown>; signal: AbortSignal | null }>,
    rpc: (_name: string, _args: Record<string, unknown>): Answer | Promise<Answer> => ({ data: null, error: null, status: 200 }),
  };
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      const call = { name, args, signal: null as AbortSignal | null };
      state.calls.push(call);
      const builder = {
        abortSignal(signal: AbortSignal) {
          call.signal = signal;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => state.rpc(name, args)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return Object.assign(state, { client });
});

vi.mock('../lib/supabase', () => ({ supabase: db.client }));

import {
  DEFAULT_BOT, GROUP_ERROR_TEXT, GROUP_HOURS, TelegramGroupError, fetchTelegramGroups, groupErrorText, groupLinkUrl, normalizeGroup,
  requestGroupCode, setTelegramGroup, telegramGroupError,
} from './telegramGroups';

const CID = 'a1b2c3d4-0000-4000-8000-000000000001';
const CHAT = -1001234567890;
const CODE = `G${'7e'.repeat(16)}`;
const GROUP = { chat_id: CHAT, title: '3-ПО', post_hour: 12, tz: 'Europe/Minsk', on: true, off_reason: null, bound_at: '2026-10-16T09:00:00Z', link_active: true };
const STATE = { telegram_linked: true, link_active: true, bot_username: 'Meldyteach_bot', hours: [9, 12, 15, 18], default_hour: 12, groups: [GROUP] };

const ok = (data: unknown): Answer => ({ data, error: null, status: 200 });
const fail = (code: string, status = 400, message = ''): Answer => ({ data: null, error: { code, message, details: null, hint: null }, status });

beforeEach(() => {
  db.calls.length = 0;
  db.rpc = () => ok(null);
});

describe('telegram_groups (CONTRACT_T7 «Site»)', () => {
  it('reads the state and the exam\'s chats', async () => {
    db.rpc = () => ok(STATE);
    const controller = new AbortController();
    const state = await fetchTelegramGroups(CID, controller.signal);
    expect(db.calls[0]).toMatchObject({ name: 'telegram_groups', args: { p_container_id: CID } });
    expect(db.calls[0].signal).toBe(controller.signal);
    expect(state).toEqual({
      telegramLinked: true, linkActive: true, bot: 'Meldyteach_bot', hours: [9, 12, 15, 18], defaultHour: 12,
      groups: [{ chatId: CHAT, title: '3-ПО', hour: 12, zone: 'Europe/Minsk', on: true, offReason: null, boundAt: '2026-10-16T09:00:00Z', linkActive: true }],
    });
  });

  it('a bot before /setup, odd hours, a chat without a title, a chat turned off', async () => {
    db.rpc = () => ok({
      telegram_linked: false, link_active: false, bot_username: null, hours: [7, 'x'], default_hour: 25,
      groups: [{ ...GROUP, title: '', on: false, off_reason: 'empty', post_hour: 3 }, { chat_id: 'not a chat' }, null],
    });
    const state = await fetchTelegramGroups(CID);
    expect(state).toMatchObject({ telegramLinked: false, linkActive: false, bot: DEFAULT_BOT, hours: [...GROUP_HOURS], defaultHour: 12 });
    expect(state?.groups).toEqual([{ chatId: CHAT, title: null, hour: 12, zone: 'Europe/Minsk', on: false, offReason: 'empty', boundAt: '2026-10-16T09:00:00Z', linkActive: true }]);
  });

  it('a database without the functions → null (the section says so); other errors throw in Russian', async () => {
    db.rpc = () => fail('PGRST202', 404);
    await expect(fetchTelegramGroups(CID)).resolves.toBeNull();
    db.rpc = () => fail('42501', 403);
    await expect(fetchTelegramGroups(CID)).rejects.toMatchObject({ code: 'not_author', message: 'Подключить беседу может только автор экзамена.' });
    db.rpc = () => fail('', 401);
    await expect(fetchTelegramGroups(CID)).rejects.toMatchObject({ code: 'signed_out' });
    db.rpc = () => ok({ nothing: true });
    await expect(fetchTelegramGroups(CID)).rejects.toMatchObject({ code: 'unknown' });
    db.rpc = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(fetchTelegramGroups(CID)).rejects.toMatchObject({ code: 'network', status: 0 });
  });
});

describe('telegram_group_code', () => {
  it('a code for the hour and the startgroup link', async () => {
    db.rpc = () => ok({ code: CODE, expires_at: '2026-10-16T10:00:00Z', post_hour: 15, bot_username: 'Meldyteach_bot' });
    const code = await requestGroupCode(CID, 15);
    expect(db.calls[0]).toMatchObject({ name: 'telegram_group_code', args: { p_container_id: CID, p_post_hour: 15 } });
    expect(code).toEqual({ code: CODE, url: `https://t.me/Meldyteach_bot?startgroup=${CODE}`, bot: 'Meldyteach_bot', hour: 15, expiresAt: '2026-10-16T10:00:00Z' });
  });

  it('without a bot name yet: @Meldyteach_bot; a broken code is not opened', async () => {
    db.rpc = () => ok({ code: CODE, expires_at: null, post_hour: 9, bot_username: null });
    expect((await requestGroupCode(CID, 9)).url).toBe(`https://t.me/Meldyteach_bot?startgroup=${CODE}`);
    db.rpc = () => ok({ code: 'G123', bot_username: 'Meldyteach_bot' });
    await expect(requestGroupCode(CID, 9)).rejects.toMatchObject({ code: 'unknown' });
    expect(groupLinkUrl('bad name!', CODE)).toBe(`https://t.me/${DEFAULT_BOT}?startgroup=${CODE}`);
  });

  it('only the four hours; each refusal in Russian', async () => {
    await expect(requestGroupCode(CID, 10)).rejects.toMatchObject({ code: 'invalid' });
    expect(db.calls).toHaveLength(0);
    const cases: Array<[Answer, string, string]> = [
      [fail('P0002'), 'not_linked', 'Сначала подключите Telegram в профиле.'],
      [fail('MT002'), 'no_link', 'Сначала создайте ссылку для группы.'],
      [fail('MT001'), 'too_many', 'Слишком много попыток. Попробуйте через час.'],
      [fail('42501', 403), 'not_author', 'Подключить беседу может только автор экзамена.'],
      [fail('22023'), 'invalid', GROUP_ERROR_TEXT.invalid],
      [fail('28000', 401), 'signed_out', GROUP_ERROR_TEXT.signed_out],
      [fail('XX000', 500), 'unknown', GROUP_ERROR_TEXT.unknown],
    ];
    for (const [answer, code, text] of cases) {
      db.rpc = () => answer;
      const error = await requestGroupCode(CID, 12).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramGroupError);
      expect(error).toMatchObject({ code, message: text });
      expect(groupErrorText(error)).toBe(text);
    }
    expect(groupErrorText(new Error('boom'))).toBe(GROUP_ERROR_TEXT.unknown);
  });
});

describe('telegram_group_set', () => {
  it('changes the hour, or turns the chat off and on; what is not given stays', async () => {
    db.rpc = (_name, args) => ok({ ...GROUP, post_hour: args.p_post_hour ?? 12, on: args.p_on ?? true, off_reason: args.p_on === false ? 'author' : null });
    expect(await setTelegramGroup(CHAT, { hour: 18 })).toMatchObject({ chatId: CHAT, hour: 18, on: true });
    expect(db.calls[0]).toMatchObject({ name: 'telegram_group_set', args: { p_chat_id: CHAT, p_post_hour: 18, p_on: null } });
    expect(await setTelegramGroup(CHAT, { on: false })).toMatchObject({ on: false, offReason: 'author' });
    expect(db.calls[1].args).toEqual({ p_chat_id: CHAT, p_post_hour: null, p_on: false });
    await expect(setTelegramGroup(CHAT, { hour: 13 })).rejects.toMatchObject({ code: 'invalid' });
    expect(db.calls).toHaveLength(2);
  });

  it('a chat the bot left → «Бота уже нет в этой беседе.»', async () => {
    db.rpc = () => fail('P0002');
    await expect(setTelegramGroup(CHAT, { on: true })).rejects.toMatchObject({ code: 'not_found', message: 'Бота уже нет в этой беседе.' });
  });
});

describe('shapes and words', () => {
  it('normalizeGroup keeps only a group chat id and the four hours', () => {
    expect(normalizeGroup({ ...GROUP, chat_id: 42 })).toBeNull();
    expect(normalizeGroup({ ...GROUP, chat_id: String(CHAT) })?.chatId).toBe(CHAT);
    expect(normalizeGroup({ ...GROUP, on: false, off_reason: null })?.offReason).toBe('author');
    expect(normalizeGroup({ ...GROUP, link_active: false })?.linkActive).toBe(false);
  });

  it('error mapping: a missing function, the status codes', () => {
    expect(telegramGroupError({ code: '42883' }).code).toBe('missing');
    expect(telegramGroupError({ code: 'PGRST301' }).code).toBe('signed_out');
    expect(telegramGroupError({}, 429).code).toBe('too_many');
    expect(telegramGroupError({ code: 'P0002' }, 400, 'set').code).toBe('not_found');
    expect(telegramGroupError({}, 0).code).toBe('network');
  });

  it('every line follows the copy rules (no «тест», «контейнер», «!», capitals)', () => {
    for (const text of Object.values(GROUP_ERROR_TEXT)) {
      expect(text).not.toMatch(/(^|[^а-яё])тест|контейнер|преподавател|!/iu);
      expect(text).not.toMatch(/[А-ЯЁ]{4,}/u);
      expect(text.endsWith('.')).toBe(true);
    }
  });
});
