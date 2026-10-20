import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));

import { LiveError } from '../../../lib/live/types';
import { errorText } from './copy';
import { pinOf, reviewGameOf, telegramJoin } from './telegram';

const TOKEN = 'T'.repeat(43);
const JOINED = { status: 'joined', token: TOKEN, game_id: '00000000-0000-4000-8000-000000000001', player_id: 'p', topic: 't', state: 'lobby', rev: 2, now: '2026-10-21T10:00:00.000Z', name: 'Алина', look: { body: 'round', colour: 'blue', eyes: 'dots', hat: 'none' }, wardrobe: { unlocked: ['crown'], games: 3, wins: 1 } };
const noWait = async () => undefined;

async function refusal(body: Record<string, unknown>): Promise<LiveError> {
  invoke.mockResolvedValueOnce({ data: body, error: null });
  try {
    await telegramJoin('init', '482913', null, null, noWait);
  } catch (e) {
    return e as LiveError;
  }
  throw new Error('joined');
}

beforeEach(() => invoke.mockReset());

describe('/telegram/game/join from the Mini App', () => {
  it('sends the launch, the PIN, the look and the typed name; returns the result and the function\'s token', async () => {
    invoke.mockResolvedValueOnce({ data: JOINED, error: null });
    const look = { body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' } as const;
    const joined = await telegramJoin('query_id=1&hash=abc', '482913', look, '  Алина К  ', noWait);
    expect(invoke).toHaveBeenCalledWith('telegram/game/join', expect.objectContaining({ body: { init_data: 'query_id=1&hash=abc', pin: '482913', look, name: 'Алина К' } }));
    expect(joined.token).toBe(TOKEN);
    expect(joined.result).toMatchObject({ game_id: JOINED.game_id, name: 'Алина', wardrobe: { unlocked: ['crown'] } });
    expect(joined.result).not.toHaveProperty('token');
    expect(joined.result).not.toHaveProperty('status');
  });

  it('without a name the body has none (the function takes Telegram\'s first name)', async () => {
    invoke.mockResolvedValueOnce({ data: JOINED, error: null });
    await telegramJoin('init', '482913', null, null, noWait);
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('name');
  });

  it('maps every refusal to the player\'s words', async () => {
    expect((await refusal({ status: 'not_found' })).code).toBe('P0002');
    expect(errorText(await refusal({ status: 'not_found' }), '482913')).toBe('Игры с PIN 482 913 нет. Проверьте цифры у ведущего.');
    expect((await refusal({ status: 'full' })).code).toBe('ML001');
    expect((await refusal({ status: 'ended' })).code).toBe('ML002');
    expect((await refusal({ status: 'members_only' })).code).toBe('ML003');
    expect((await refusal({ status: 'slow_down' })).code).toBe('ML005');
    expect(await refusal({ status: 'kicked' })).toMatchObject({ code: '42501', detail: 'kicked' });
    for (const s of ['invalid', 'stale', 'replayed']) expect(errorText(await refusal({ status: s }), null)).toBe('Откройте игру заново кнопкой «Играть» в беседе.');
    // name_refused / look_refused: a code, or the reason already in words.
    expect(errorText(await refusal({ status: 'name_refused', reason: 'rude' }), null)).toBe('Такое имя не подойдёт. Выберите другое.');
    expect(errorText(await refusal({ status: 'name_refused', reason: 'Имя занято в этой игре.' }), null)).toBe('Имя занято в этой игре.');
    expect(errorText(await refusal({ status: 'look_refused', reason: 'locked' }), null)).toBe('Эта часть ещё закрыта. Выберите другую.');
    expect((await refusal({ status: 'something_new' })).code).toBe('unknown');
    // A «joined» without a proper token is not a join.
    expect((await refusal({ ...JOINED, token: 'short' })).code).toBe('unknown');
  });

  it('a lost answer is asked again (the same launch may join again); a refusal is not', async () => {
    const lost = { data: null, error: Object.assign(new Error('fetch failed'), { name: 'FunctionsFetchError' }) };
    invoke.mockResolvedValueOnce(lost).mockResolvedValueOnce(lost).mockResolvedValueOnce({ data: JOINED, error: null });
    const waits: number[] = [];
    const joined = await telegramJoin('init', '482913', null, null, async (ms) => {
      waits.push(ms);
    });
    expect(joined.token).toBe(TOKEN);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([800, 2000]);
    invoke.mockReset();
    invoke.mockResolvedValue(lost);
    await expect(telegramJoin('init', '482913', null, null, noWait)).rejects.toMatchObject({ code: 'network' });
    expect(invoke).toHaveBeenCalledTimes(3);
    invoke.mockReset();
    invoke.mockResolvedValueOnce({ data: { status: 'full' }, error: null });
    await expect(telegramJoin('init', '482913', null, null, noWait)).rejects.toMatchObject({ code: 'ML001' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('the start parameter: a PIN or a game\'s review, nothing else', () => {
    expect(pinOf('482913')).toBe('482913');
    expect(pinOf('48291')).toBeNull();
    expect(pinOf('r_0a1b')).toBeNull();
    expect(pinOf(null)).toBeNull();
    expect(reviewGameOf('r_0A1B2C3D4E5F4A6B8C7D0123456789AB')).toBe('0a1b2c3d-4e5f-4a6b-8c7d-0123456789ab');
    expect(reviewGameOf('r_0a1b')).toBeNull();
    expect(reviewGameOf('482913')).toBeNull();
  });
});
