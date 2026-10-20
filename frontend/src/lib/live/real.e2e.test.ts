/**
 * real.ts end to end against a local database through PostgREST 12 (supabase/tests/local/live_game_e2e.sh sets the
 * LIVE_E2E_* variables; without them the suite is skipped). The client is the real one: only `../supabase` is a
 * supabase-js client pointed at the local PostgREST (its /rest/v1 prefix removed, the caller's JWT and address put on
 * each request) and `../supabaseRoute` says «proxy» (no Realtime here: the screens then poll every second).
 * A game: create → join ×3 → next → answer → reveal → … → podium → review, with the refusals by the body's code and
 * the contract's HTTP status.
 */
import { describe, expect, it, vi } from 'vitest';
import { newLiveToken } from './api';
import { createRealApi } from './real';
import { LiveError, isUnchanged, type GameState, type HostState, type PlayerState } from './types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const URL_ = env.LIVE_E2E_URL ?? '';
const SECRET = env.LIVE_E2E_SECRET ?? '';

const box = vi.hoisted(() => ({ auth: '', ip: '198.51.100.1' }));

const b64url = (bytes: Uint8Array) => {
  let text = '';
  bytes.forEach((b) => {
    text += String.fromCharCode(b);
  });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** An HS256 JWT signed with the local PostgREST's secret. */
async function jwt(claims: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const head = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(head))))}`;
}

vi.mock('../supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const base = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE_E2E_URL ?? 'http://127.0.0.1:1';
  const localFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace('/rest/v1/', '/');
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${box.auth}`);
    headers.set('x-forwarded-for', box.ip);
    return fetch(url, { ...init, headers });
  };
  return { supabase: createClient(base, 'local-anon-key', { global: { fetch: localFetch }, auth: { persistSession: false, autoRefreshToken: false } }) };
});
vi.mock('../supabaseRoute', () => ({ preferredRoute: () => 'proxy' }));

const asAuthor = async () => {
  box.auth = await jwt({ role: 'authenticated', sub: env.LIVE_E2E_AUTHOR });
};
const asGuest = async () => {
  box.auth = await jwt({ role: 'anon' });
};
const caught = async (p: Promise<unknown>): Promise<LiveError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof LiveError) return e;
    throw e;
  }
  throw new Error('no error');
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!URL_)('real.ts end to end (local PostgREST)', () => {
  it('create → join ×3 → next → answer → reveal → … → podium → review', async () => {
    const api = createRealApi();
    const source = { container_id: env.LIVE_E2E_CONTAINER!, subject_ids: [env.LIVE_E2E_SUBJECT!], count: 3 };
    const settings = { mode: 'boss' as const, time_s: 10 as const, speed: true, who: 'pin' as const, chat_names: true };

    await asGuest();
    const anonCreate = await caught(api.create(source, settings));
    expect([anonCreate.code, anonCreate.status]).toEqual(['28000', 401]);

    await asAuthor();
    const g = await api.create(source, settings);
    expect(g.q_count).toBe(3);
    expect(g.skipped).toBe(0);
    expect(g.host_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(g.join_url).toBe(`https://ludosiel-studyforge.hf.space/play?pin=${g.pin}`);

    await asGuest();
    const tokens = [newLiveToken(), newLiveToken(), newLiveToken()];
    const names = ['Дима', 'Лена', 'Артём'];
    const joined = [];
    for (let i = 0; i < 3; i += 1) joined.push(await api.join(g.pin, names[i], tokens[i], null));
    expect(joined.map((j) => j.name)).toEqual(names);
    expect(joined[2].rev).toBe(4);
    expect(joined[0].topic).toBe(g.topic);
    expect(joined[0].wardrobe).toBeNull();

    const badPin = await caught(api.join('000000', 'Кто-то', newLiveToken(), null));
    expect([badPin.code, badPin.detail, badPin.status]).toEqual(['P0002', 'pin', 404]);
    const rude = await caught(api.join(g.pin, 'Су-ка', newLiveToken(), null));
    expect([rude.code, rude.detail, rude.status]).toEqual(['ML006', 'rude', 400]);
    const wrongHost = await caught(api.hostState(g.game_id, 'x'.repeat(43)));
    expect([wrongHost.code, wrongHost.detail, wrongHost.status]).toEqual(['42501', 'host', 403]);
    const noGame = await caught(api.state('00000000-0000-4000-8000-000000000000', tokens[0]));
    expect([noGame.code, noGame.detail, noGame.status]).toEqual(['P0002', 'game', 404]);

    const lobby = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(lobby.state).toBe('lobby');
    expect(lobby.roster.map((r) => r.name).sort()).toEqual([...names].sort());
    const skipped = await caught(api.next(g.game_id, g.host_token, 'reveal'));
    expect([skipped.code, skipped.detail, skipped.status]).toEqual(['ML011', 'lobby', 409]);
    await api.setLook(g.game_id, tokens[1], { body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' });

    let host = await api.next(g.game_id, g.host_token, 'lobby');
    expect(host.state).toBe('countdown');
    expect(host.boss.hp_max).toBe(3 * 3 * 55);
    let questions = 0;
    let seenOpen = false;
    for (let guard = 0; guard < 400 && host.state !== 'podium'; guard += 1) {
      if (host.state === 'countdown' || host.state === 'open') {
        const me = (await api.state(g.game_id, tokens[0])) as PlayerState;
        expect(JSON.stringify(me)).not.toMatch(/"key"|"counts"/);
        if (me.state === 'countdown') {
          const early = await caught(api.answer(g.game_id, tokens[0], me.qi, 0));
          expect([early.code, early.detail]).toEqual(['ML004', 'early']);
          await sleep(Math.max(50, Date.parse(me.question!.opens_at) - Date.parse(me.now) + 20));
        } else if (me.state === 'open') {
          seenOpen = true;
          questions += 1;
          const qi = me.qi;
          const ack = await api.answer(g.game_id, tokens[0], qi, 0);
          expect(ack).toMatchObject({ accepted: true, answered: 1 });
          expect(Object.keys(ack).sort()).toEqual(['accepted', 'answered', 'now']);
          const twice = await caught(api.answer(g.game_id, tokens[0], qi, 1));
          expect([twice.code, twice.detail, twice.status]).toEqual(['ML004', 'twice', 400]);
          const mid = (await api.hostState(g.game_id, g.host_token)) as HostState;
          expect(mid.state).toBe('open');
          expect(mid.answered_ids).toEqual([joined[0].player_id]);
          expect(JSON.stringify(mid)).not.toMatch(/"key"|"counts"/);
          await api.answer(g.game_id, tokens[1], qi, 0);
          await api.answer(g.game_id, tokens[2], qi, 1);
          const shown = (await api.hostState(g.game_id, g.host_token)) as HostState;
          expect(shown.state).toBe('reveal');
          const r = shown.result!;
          expect(r.qi).toBe(qi);
          expect(r.counts.reduce((a, b) => a + b, 0)).toBe(3);
          expect(r.right).toBe(r.counts[r.key]);
          const mine = (await api.state(g.game_id, tokens[2])) as PlayerState;
          expect(mine.result!.correct).toBe(r.key === 1);
          expect(mine.result!.key).toBe(r.key);
          const again = await api.state(g.game_id, tokens[2], mine.rev);
          expect(isUnchanged(again)).toBe(true);
          host = shown;
          continue;
        }
        host = (await api.hostState(g.game_id, g.host_token)) as HostState;
        continue;
      }
      host = await api.next(g.game_id, g.host_token, host.state as GameState);
    }
    expect(seenOpen).toBe(true);
    expect(host.state).toBe('podium');
    expect(host.final).not.toBeNull();
    expect(questions).toBeGreaterThanOrEqual(1);

    const final = (await api.state(g.game_id, tokens[0])) as PlayerState;
    expect(final.final!.accuracy_pct).toBe(host.final!.accuracy_pct);
    expect(final.top!.length).toBe(3);
    const review = await api.review(g.game_id, tokens[0]);
    expect(review.items).toHaveLength(questions);
    for (const item of review.items) {
      expect(item.choice).toBe(0);
      expect(item.correct).toBe(item.key === 0);
    }
    const ended = await api.next(g.game_id, g.host_token, 'podium');
    expect(ended.state).toBe('ended');
    await api.end(g.game_id, g.host_token);
  }, 120_000);

  it('120 joins a minute per address, then 429 with Retry-After through PostgREST; kick answers 403 to the kicked', async () => {
    const api = createRealApi();
    await asAuthor();
    const g = await api.create({ container_id: env.LIVE_E2E_CONTAINER!, subject_ids: [env.LIVE_E2E_SUBJECT!], count: 3 },
      { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: true });
    await asGuest();
    box.ip = '203.0.113.99';
    const tokens: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      tokens.push(newLiveToken());
      await api.join(g.pin, `Игрок ${i + 1}`, tokens[i], null);
    }
    const busy = await caught(api.join(g.pin, 'Сто двадцать первый', newLiveToken(), null));
    expect([busy.code, busy.detail, busy.status]).toEqual(['ML005', 'join', 429]);
    // The same refusal as PostgREST sends it: 429 with a short Retry-After.
    const raw = await fetch(`${URL_}/rpc/live_join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${box.auth}`, 'x-forwarded-for': box.ip },
      body: JSON.stringify({ p_pin: g.pin, p_name: 'Ещё один', p_token: newLiveToken(), p_look: null }),
    });
    expect(raw.status).toBe(429);
    expect(Number(raw.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(raw.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(await raw.json()).toMatchObject({ code: 'ML005', details: 'join' });
    box.ip = '198.51.100.1';
    const host = (await api.hostState(g.game_id, g.host_token)) as HostState;
    await api.kick(g.game_id, g.host_token, host.roster[0].player_id);
    const kickedToken = tokens[0];
    const kicked = await caught(api.state(g.game_id, kickedToken));
    expect([kicked.code, kicked.detail, kicked.status]).toEqual(['42501', 'kicked', 403]);
    await api.end(g.game_id, g.host_token);
  }, 60_000);
});
