import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TELEGRAM_ERROR_TEXT, TelegramApiError, fetchTelegramState, isTelegramMissing, normalizeState, startTelegramLink,
  telegramError, telegramErrorText, unlinkTelegram, updateTelegramSettings,
} from './telegram';

type Answer = { data?: unknown; error?: unknown; status?: number } | Error;

const db = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown; signal: AbortSignal | null }>,
  answers: [] as Answer[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      const entry = { name, args, signal: null as AbortSignal | null };
      db.calls.push(entry);
      const settle = () => {
        const answer = db.answers.shift() ?? { data: null, error: null, status: 200 };
        if (answer instanceof Error) return Promise.reject(answer);
        return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 });
      };
      return {
        abortSignal(signal: AbortSignal) {
          entry.signal = signal;
          return { then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => settle().then(ok, fail) };
        },
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => settle().then(ok, fail),
      };
    },
  },
}));

const HEX = '0123456789abcdef0123456789abcdef';
const LINKED = { linked: true, bot_username: 'Meldyteach_bot', remind_on: true, remind_at: '20:00', tz: 'Europe/Minsk', paused_until: null, blocked: false };

beforeEach(() => {
  db.calls.length = 0;
  db.answers.length = 0;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Vladivostok' } as Intl.ResolvedDateTimeFormatOptions);
});

describe('telegram_link_state', () => {
  it('reads the link with the student’s session, without arguments', async () => {
    db.answers.push({ data: LINKED });
    expect(await fetchTelegramState()).toEqual({
      linked: true, bot: 'Meldyteach_bot', remindOn: true, remindAt: '20:00', zone: 'Europe/Minsk', pausedUntil: null, blocked: false,
    });
    expect(db.calls).toEqual([{ name: 'telegram_link_state', args: {}, signal: null }]);
  });

  it('reads a pause, a block, «Не присылать», the time with seconds and the exam the server names', async () => {
    db.answers.push({
      data: {
        ...LINKED, remind_on: false, remind_at: '07:30:00', paused_until: '2026-10-19', blocked_at: '2026-10-16T10:00:00Z',
        exam: { title: 'Осенняя сессия', date: '2026-11-03' },
      },
    });
    expect(await fetchTelegramState()).toMatchObject({
      remindOn: false, remindAt: '07:30', pausedUntil: '2026-10-19', blocked: true, exam: { title: 'Осенняя сессия', date: '2026-11-03' },
    });
  });

  it('tells «no exam» (null) from «not said» (no field)', async () => {
    db.answers.push({ data: { ...LINKED, exam: null } }, { data: LINKED }, { data: { ...LINKED, exam: { title: 'Осенняя сессия', exam_date: null } } });
    expect((await fetchTelegramState())!.exam).toBeNull();
    expect(await fetchTelegramState()).not.toHaveProperty('exam');
    expect((await fetchTelegramState())!.exam).toEqual({ title: 'Осенняя сессия', date: null });
  });

  it('reads a student without Telegram', async () => {
    db.answers.push({ data: { linked: false, bot_username: null } });
    expect(await fetchTelegramState()).toEqual({
      linked: false, bot: 'Meldyteach_bot', remindOn: true, remindAt: '20:00', zone: null, pausedUntil: null, blocked: false,
    });
  });

  it('resolves null when the database has no Telegram functions (the card hides itself)', async () => {
    for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) {
      db.answers.push({ error: { code, message: 'Could not find the function public.telegram_link_state' }, status: 404 });
      expect(await fetchTelegramState()).toBeNull();
    }
  });

  it('throws on any other failure, in Russian', async () => {
    db.answers.push({ error: { code: 'XX000', message: 'boom' }, status: 500 });
    await expect(fetchTelegramState()).rejects.toMatchObject({ code: 'unknown', status: 500, message: TELEGRAM_ERROR_TEXT.unknown });
    db.answers.push(new TypeError('Failed to fetch'));
    await expect(fetchTelegramState()).rejects.toMatchObject({ code: 'network' });
    db.answers.push({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 });
    await expect(fetchTelegramState()).rejects.toMatchObject({ code: 'signed_out', message: 'Сессия истекла. Войдите снова.' });
  });

  it('refuses a body that is not the state', async () => {
    for (const data of [null, 'ok', [], { linked: 'yes' }]) {
      db.answers.push({ data });
      await expect(fetchTelegramState()).rejects.toBeInstanceOf(TelegramApiError);
    }
  });

  it('hands the signal to the request', async () => {
    db.answers.push({ data: LINKED });
    const controller = new AbortController();
    await fetchTelegramState(controller.signal);
    expect(db.calls[0].signal).toBe(controller.signal);
  });
});

describe('telegram_link_start', () => {
  it('sends the browser’s zone and returns the code with its link', async () => {
    db.answers.push({ data: { code: `L${HEX}`, expires_at: '2026-10-16T12:15:00Z', bot_username: 'Meldyteach_bot' } });
    expect(await startTelegramLink()).toEqual({
      code: `L${HEX}`, url: `https://t.me/Meldyteach_bot?start=L${HEX}`, bot: 'Meldyteach_bot', expiresAt: '2026-10-16T12:15:00Z',
    });
    expect(db.calls).toEqual([{ name: 'telegram_link_start', args: { p_tz: 'Asia/Vladivostok' }, signal: null }]);
  });

  it('builds the link to @Meldyteach_bot when the bot has not been set up yet', async () => {
    db.answers.push({ data: { code: HEX, expires_at: null, bot_username: null } });
    expect((await startTelegramLink('Europe/Minsk')).url).toBe(`https://t.me/Meldyteach_bot?start=L${HEX}`);
  });

  it('says «Слишком много попыток» after five codes in an hour', async () => {
    db.answers.push({ error: { code: 'MB429', message: 'too many codes' }, status: 400 });
    const error = await startTelegramLink().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'too_many' });
    expect(telegramErrorText(error)).toBe('Слишком много попыток. Попробуйте через час.');
  });

  it('asks once more with Europe/Minsk when the server does not know the browser’s zone', async () => {
    db.answers.push({ error: { code: '22023', message: 'unknown time zone' }, status: 400 }, { data: { code: `L${HEX}`, expires_at: null, bot_username: 'Meldyteach_bot' } });
    expect((await startTelegramLink('America/Ciudad_Juarez')).code).toBe(`L${HEX}`);
    expect(db.calls.map((call) => call.args)).toEqual([{ p_tz: 'America/Ciudad_Juarez' }, { p_tz: 'Europe/Minsk' }]);
  });

  it('does not ask twice with Europe/Minsk', async () => {
    db.answers.push({ error: { code: '22023', message: 'unknown time zone' }, status: 400 });
    await expect(startTelegramLink('Europe/Minsk')).rejects.toMatchObject({ code: 'invalid' });
    expect(db.calls).toHaveLength(1);
  });

  it('throws «missing» without the function, and refuses a code that is not one', async () => {
    db.answers.push({ error: { code: 'PGRST202', message: 'no function' }, status: 404 });
    const missing = await startTelegramLink().catch((e: unknown) => e);
    expect(isTelegramMissing(missing)).toBe(true);
    db.answers.push({ data: { code: 'L123', expires_at: null, bot_username: 'Meldyteach_bot' } });
    await expect(startTelegramLink()).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('telegram_settings and telegram_unlink', () => {
  it('sends the time, the switch and the zone; null leaves a value as it is', async () => {
    db.answers.push({ data: { ...LINKED, remind_at: '07:30' } }, { data: LINKED });
    expect((await updateTelegramSettings({ remindAt: '7:30', zone: 'Europe/Minsk' })).remindAt).toBe('07:30');
    await updateTelegramSettings({ remindOn: true });
    expect(db.calls.map((call) => [call.name, call.args])).toEqual([
      ['telegram_settings', { p_remind_on: null, p_remind_at: '07:30', p_tz: 'Europe/Minsk' }],
      ['telegram_settings', { p_remind_on: true, p_remind_at: null, p_tz: null }],
    ]);
  });

  it('refuses a time that is not one before asking the server', async () => {
    await expect(updateTelegramSettings({ remindAt: '25:99' })).rejects.toMatchObject({ code: 'invalid' });
    expect(db.calls).toHaveLength(0);
  });

  it('maps «not linked»', async () => {
    db.answers.push({ error: { code: 'MB404', message: 'telegram is not linked' }, status: 400 });
    await expect(updateTelegramSettings({ remindOn: false })).rejects.toMatchObject({ code: 'not_linked' });
  });

  it('unlinks and returns the state, also when the function returns nothing', async () => {
    db.answers.push({ data: { linked: false, bot_username: 'Meldyteach_bot' } }, { data: null });
    expect((await unlinkTelegram()).linked).toBe(false);
    expect((await unlinkTelegram()).linked).toBe(false);
    expect(db.calls.map((call) => [call.name, call.args])).toEqual([['telegram_unlink', {}], ['telegram_unlink', {}]]);
  });
});

describe('errors', () => {
  it('keeps an error of its own and names the general line for anything else', () => {
    const own = new TelegramApiError('too_many', 400);
    expect(telegramError(own)).toBe(own);
    expect(telegramErrorText(new Error('English'))).toBe(TELEGRAM_ERROR_TEXT.unknown);
    expect(telegramError({ code: '', message: '' }, 0).code).toBe('network');
    expect(telegramError({ code: '', message: 'rate' }, 429).code).toBe('too_many');
  });

  it('normalizes the state of a bot that is not a bot name to @Meldyteach_bot', () => {
    expect(normalizeState({ linked: false, bot_username: 'evil.example' }).bot).toBe('Meldyteach_bot');
  });
});
