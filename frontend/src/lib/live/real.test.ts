/**
 * real.ts's PIN step against a stubbed supabase-js: `live_pin`'s answer as it comes (HTTP 200), and the old check through
 * `live_join` with the empty name while PostgREST does not know live_pin (PGRST202: the migration not applied yet, or
 * rolled back). The whole client runs against a real PostgREST in real.e2e.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveError } from './types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));
vi.mock('../supabaseRoute', () => ({ preferredRoute: () => 'proxy' }));

const { createRealApi } = await import('./real');

const TOKEN = 'T'.repeat(43);
const JOINED = { game_id: 'g', player_id: 'p', topic: 't', state: 'lobby', rev: 2, now: '2026-10-22T09:00:00.000Z', name: 'Дима', look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }, wardrobe: null };
const refusal = (status: number, code: string, details: string | null) => ({ data: null, status, error: { code, details, message: `live: ${code}`, hint: null } });
const noLivePin = refusal(404, 'PGRST202', 'Searched for the function public.live_pin with parameters p_pin, p_token');

beforeEach(() => {
  rpc.mockReset();
});

describe('real.ts pin()', () => {
  it('asks live_pin with the PIN and the token and gives its answer as it is', async () => {
    const answers = [
      { status: 'open', mode: 'boss' },
      { status: 'refused', code: 'P0002', detail: 'pin', http: 404, retry_after: null },
      { status: 'joined', ...JOINED },
    ];
    for (const answer of answers) {
      rpc.mockResolvedValueOnce({ data: answer, error: null, status: 200 });
      expect(await createRealApi().pin('482913', TOKEN)).toEqual(answer);
    }
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['live_pin', 'live_pin', 'live_pin']);
    expect(rpc).toHaveBeenCalledWith('live_pin', { p_pin: '482913', p_token: TOKEN });
  });

  it('without live_pin on the server: the old check through live_join with the empty name, as data', async () => {
    const cases: [unknown, unknown][] = [
      [refusal(400, 'ML006', 'length'), { status: 'open', mode: null }],
      [refusal(404, 'P0002', 'pin'), { status: 'refused', code: 'P0002', detail: 'pin', http: 404, retry_after: null }],
      [refusal(403, '42501', 'kicked'), { status: 'refused', code: '42501', detail: 'kicked', http: 403, retry_after: null }],
      [refusal(429, 'ML005', 'join'), { status: 'refused', code: 'ML005', detail: 'join', http: 429, retry_after: null }],
      [{ data: JOINED, error: null, status: 200 }, { status: 'joined', ...JOINED }],
    ];
    for (const [old, want] of cases) {
      rpc.mockReset();
      rpc.mockResolvedValueOnce(noLivePin).mockResolvedValueOnce(old);
      expect(await createRealApi().pin('482913', TOKEN)).toEqual(want);
      expect(rpc.mock.calls).toEqual([
        ['live_pin', { p_pin: '482913', p_token: TOKEN }],
        ['live_join', { p_pin: '482913', p_name: '', p_token: TOKEN, p_look: null }],
      ]);
    }
  });

  it('a lost network or an unknown failure throws, as the join does', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const lost = await createRealApi().pin('482913', TOKEN).catch((e: unknown) => e);
    expect(lost).toBeInstanceOf(LiveError);
    expect((lost as LiveError).code).toBe('network');
    rpc.mockResolvedValueOnce(refusal(500, 'XX000', null));
    const odd = await createRealApi().pin('482913', TOKEN).catch((e: unknown) => e);
    expect((odd as LiveError).code).toBe('unknown');
    expect(rpc).toHaveBeenCalledTimes(2);
    rpc.mockResolvedValueOnce(noLivePin).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const lostOld = await createRealApi().pin('482913', TOKEN).catch((e: unknown) => e);
    expect((lostOld as LiveError).code).toBe('network');
  });
});
